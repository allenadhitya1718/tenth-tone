// The chat being read right now, shared by the push code that runs inside the
// app (push.ts) and the headless background task (features/call/background.ts).
// Kept in its own file so the background task does not pull in React.

let activeChatId: string | null = null;

// The chat screen calls this with its id on focus and null on blur, so a
// message in the conversation you are reading does not also pop a banner.
export function setActiveChatId(id: string | null) {
  activeChatId = id;
}

export const getActiveChatId = () => activeChatId;
