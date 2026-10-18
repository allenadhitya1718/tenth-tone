import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';

import { hasOnboarded } from '@/lib/onboarding';

// First launch gets the feature tour; every launch after that goes straight
// to the new-or-returning fork.
export default function AuthIndex() {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    hasOnboarded().then(setSeen);
  }, []);
  if (seen === null) return null;
  return <Redirect href={seen ? '/welcome' : '/onboarding'} />;
}
