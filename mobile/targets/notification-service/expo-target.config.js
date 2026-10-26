// iPhone Notification Service Extension (client round 4): turns a FLYP
// message push into a "communication notification" with the sender's photo,
// as WhatsApp's look. Built only with FLYP_IOS_COMM_NOTIFS=1 (app.config.js).
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'notification-service',
  name: 'NotificationService',
  bundleIdentifier: '.notification-service',
  deploymentTarget: '16.4',
  frameworks: ['Intents', 'UserNotifications'],
};
