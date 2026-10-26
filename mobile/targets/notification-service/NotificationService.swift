import Intents
import UserNotifications

// A FLYP message push arrives with mutable-content and the sender's name and
// photo (send-push, cap 'chat_avatar'). iOS lets this extension rewrite it
// before it is shown: wrapping it in an INSendMessageIntent makes it a
// communication notification, drawn like WhatsApp's with the sender's photo
// (and the group's name for a group chat). Anything that fails shows the push
// exactly as it came.
final class NotificationService: UNNotificationServiceExtension {
  private var handler: ((UNNotificationContent) -> Void)?
  private var original: UNNotificationContent?

  // Hands the content to iOS once, whichever finishes first.
  private func finish(_ content: UNNotificationContent) {
    guard let h = handler else { return }
    handler = nil
    h(content)
  }

  override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    handler = contentHandler
    original = request.content
    let info = request.content.userInfo
    guard (info["type"] as? String) == "message",
          let chatId = info["chat_id"] as? String,
          let senderName = info["sender_name"] as? String else {
      finish(request.content)
      return
    }
    let senderId = (info["sender_id"] as? String) ?? senderName
    let isGroup = (info["is_group"] as? String) == "1"
    let groupName = info["chat_title"] as? String

    loadImage(info["sender_avatar"] as? String) { image in
      let sender = INPerson(
        personHandle: INPersonHandle(value: senderId, type: .unknown),
        nameComponents: nil,
        displayName: senderName,
        image: image,
        contactIdentifier: nil,
        customIdentifier: senderId
      )
      let me = INPerson(
        personHandle: INPersonHandle(value: "me", type: .unknown),
        nameComponents: nil, displayName: nil, image: nil, contactIdentifier: nil, customIdentifier: nil, isMe: true
      )
      let intent = INSendMessageIntent(
        // A group needs at least two recipients for iOS to show its name.
        recipients: isGroup ? [me, sender] : [me],
        outgoingMessageType: .outgoingMessageText,
        content: request.content.body,
        speakableGroupName: isGroup && groupName != nil ? INSpeakableString(spokenPhrase: groupName!) : nil,
        conversationIdentifier: chatId,
        serviceName: nil,
        sender: sender,
        attachments: nil
      )
      if isGroup, let image = image {
        intent.setImage(image, forParameterNamed: \.speakableGroupName)
      }
      let interaction = INInteraction(intent: intent, response: nil)
      interaction.direction = .incoming
      interaction.donate { _ in
        do {
          let updated = try request.content.updating(from: intent)
          self.finish(updated)
        } catch {
          self.finish(request.content)
        }
      }
    }
  }

  // iOS is about to give up: show what we have.
  override func serviceExtensionTimeWillExpire() {
    if let original = original { finish(original) }
  }

  private func loadImage(_ url: String?, done: @escaping (INImage?) -> Void) {
    guard let s = url, let u = URL(string: s), u.scheme == "https" else {
      done(nil)
      return
    }
    let task = URLSession.shared.dataTask(with: u) { data, _, _ in
      done(data.map { INImage(imageData: $0) })
    }
    task.resume()
  }
}
