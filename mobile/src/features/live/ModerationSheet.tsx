import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { report, type ReportTarget } from '@/api/moderation';
import { blockUser } from '@/api/safety';
import type { UserSummary } from '@/api/types';
import { useTheme } from '@/providers/ThemeProvider';

import { Avatar, OptionRow, Sheet } from './Sheet';
import { atHandle } from '@/lib/handle';

// Report and block from the live room (App Review 1.2), the port of
// openLiveCommentOptions / openLiveOptions / openViewerControls in V.live.
//
// reports.target_type has no 'live_comment', so a comment is reported against
// its author with the line quoted in the reason, exactly as the web app does.
// The stored reason is read by admins and kept in the web app's Arabic words;
// what the person taps is translated.

const REASONS = [
  { key: 'inappropriate', stored: 'محتوى غير لائق' },
  { key: 'hate', stored: 'خطاب كراهية أو تنمر' },
  { key: 'violence', stored: 'عنف أو محتوى صادم' },
  { key: 'impersonation', stored: 'انتحال شخصية' },
  { key: 'misleading', stored: 'محتوى مضلل' },
  { key: 'spam', stored: 'بريد عشوائي' },
  { key: 'other', stored: 'أخرى' },
] as const;

// Admin-facing context, matching the web app's.
const CONTEXT = {
  comment: 'تعليق في بث مباشر',
  speaker: 'متحدث في بث مباشر',
  viewer: 'مشاهد في بثي المباشر',
  stream: 'بث مباشر',
  host: 'مضيف بث مباشر',
} as const;

export type ModerationTarget =
  | { kind: 'comment'; user: UserSummary; text: string }
  | { kind: 'speaker'; user: UserSummary }
  | { kind: 'viewer'; user: UserSummary }
  | { kind: 'stream'; liveId: string; host: UserSummary | null };

type HostAction = { label: string; icon: 'person-add-outline' | 'mic-off-outline'; onPress: () => void };

export function ModerationSheet({
  target,
  onClose,
  onHide,
  onBlocked,
  hostAction,
}: {
  target: ModerationTarget | null;
  onClose: () => void;
  /** Hide this person's chat on this screen. */
  onHide?: (userId: string) => void;
  onBlocked?: (userId: string) => void;
  /** Host only: invite this viewer, or take this guest off stage. */
  hostAction?: HostAction | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [step, setStep] = useState<{ type: ReportTarget; id: string; context: string; detail?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setStep(null);
    onClose();
  }

  const user = target && target.kind !== 'stream' ? target.user : target?.kind === 'stream' ? target.host : null;
  const name = user?.name || user?.handle || t('live.someone');

  async function sendReport(reason: (typeof REASONS)[number]) {
    if (!step || busy) return;
    setBusy(true);
    try {
      await report({
        targetType: step.type,
        targetId: step.id,
        reason: `${reason.stored} — ${step.context}${step.detail ? `: ${step.detail.slice(0, 120)}` : ''}`,
      });
      close();
      Alert.alert(t('live.report.thanks'));
    } catch {
      Alert.alert(t('live.report.failed'));
    } finally {
      setBusy(false);
    }
  }

  function confirmBlock() {
    if (!user) return;
    Alert.alert(t('live.block.title', { name }), t('live.block.body'), [
      { text: t('live.cancel'), style: 'cancel' },
      {
        text: t('live.block.confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await blockUser(user.id);
            onBlocked?.(user.id);
            close();
            Alert.alert(t('live.block.done', { name }));
          } catch {
            Alert.alert(t('live.block.failed'));
          }
        },
      },
    ]);
  }

  let body: ReactNode = null;
  if (target && step) {
    body = (
      <ScrollView>
        <Text style={[styles.lead, { color: colors.muted }]}>{t('live.report.why')}</Text>
        {REASONS.map((r) => (
          <OptionRow key={r.key} icon="flag-outline" label={t(`live.report.reasons.${r.key}`)} onPress={() => void sendReport(r)} disabled={busy} />
        ))}
      </ScrollView>
    );
  } else if (target) {
    body = (
      <ScrollView>
        {user ? (
          <View style={styles.person}>
            <Avatar uri={user.avatar_url} name={name} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {name}
              </Text>
              {target.kind === 'comment' ? (
                <Text style={[styles.quote, { color: colors.muted }]} numberOfLines={2}>
                  {target.text}
                </Text>
              ) : user.handle ? (
                <Text style={[styles.quote, { color: colors.muted }]}>{atHandle(user.handle)}</Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {user ? (
          <OptionRow
            icon="person-circle-outline"
            label={t('live.viewProfile')}
            onPress={() => {
              close();
              router.push(`/user/${user.id}`);
            }}
          />
        ) : null}
        {hostAction ? (
          <OptionRow
            icon={hostAction.icon}
            label={hostAction.label}
            onPress={() => {
              close();
              hostAction.onPress();
            }}
          />
        ) : null}
        {target.kind === 'stream' ? (
          <OptionRow
            icon="flag-outline"
            danger
            label={t('live.report.stream')}
            onPress={() => setStep({ type: 'live_stream', id: target.liveId, context: CONTEXT.stream })}
          />
        ) : null}
        {user ? (
          <OptionRow
            icon="flag-outline"
            danger
            label={target.kind === 'comment' ? t('live.report.comment') : target.kind === 'stream' ? t('live.report.host') : t('live.report.user')}
            onPress={() =>
              setStep({
                type: 'user',
                id: user.id,
                context: target.kind === 'stream' ? CONTEXT.host : CONTEXT[target.kind],
                detail: target.kind === 'comment' ? target.text : undefined,
              })
            }
          />
        ) : null}
        {user && onHide && target.kind !== 'stream' ? (
          <OptionRow
            icon="eye-off-outline"
            label={t('live.hideComments', { name })}
            onPress={() => {
              onHide(user.id);
              close();
            }}
          />
        ) : null}
        {user ? <OptionRow icon="ban-outline" danger label={t('live.block.action', { name })} onPress={confirmBlock} /> : null}
      </ScrollView>
    );
  }

  return (
    <Sheet visible={!!target} onClose={close} title={step ? t('live.report.title') : t('live.options')}>
      {body}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 14, paddingHorizontal: 20, paddingVertical: 10 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: '700' },
  quote: { fontSize: 13, marginTop: 2 },
});
