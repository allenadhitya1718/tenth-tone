import { Redirect } from 'expo-router';

// Posting videos was removed (client change, Nov 2026): photos and videos are
// shared as stories. Old links to the post screen open the story screen.
export default function PublishRoute() {
  return <Redirect href="/stories/new" />;
}
