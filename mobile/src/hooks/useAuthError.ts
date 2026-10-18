import type { ErrorMsg } from '@/components/ui';
import { authErrorKey } from '@/lib/auth';

export function toErrorMsg(e: unknown): ErrorMsg {
  const { key, seconds } = authErrorKey(e);
  return { key, params: { seconds } };
}
