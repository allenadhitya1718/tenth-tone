import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchUserSettings,
  settingsKeys,
  updateUserSettings,
  type UserSettings,
  type UserSettingsPatch,
} from '@/api/settings';

export function useUserSettings() {
  return useQuery({ queryKey: settingsKeys.userSettings(), queryFn: fetchUserSettings });
}

// Optimistic: the switch moves at once, and goes back if the write fails.
// The caller shows the error (mutate(patch, { onError })).
export function useUpdateUserSettings() {
  const qc = useQueryClient();
  const key = settingsKeys.userSettings();
  return useMutation({
    mutationFn: (patch: UserSettingsPatch) => updateUserSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<UserSettings>(key);
      if (prev) qc.setQueryData<UserSettings>(key, { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
