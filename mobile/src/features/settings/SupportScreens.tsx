import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createSupportTicket,
  fetchMySupportTickets,
  settingsKeys,
  type SupportCategory,
  type SupportTicket,
} from '@/api/settings';
import { showAlert } from '@/components/Dialog';
import { LegalSheet } from '@/components/LegalSheet';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

import { EmptyView, errorText, go, Group, InlineError, LoadingView, Note, Row, tick } from './components';
import { GUIDELINES_DOC, SUPPORT_EMAIL } from './guidelinesDoc';

const CATEGORIES: SupportCategory[] = ['bug', 'account', 'payment', 'content', 'safety', 'other'];
const MAX = 2000;
const MIN = 10;

// ---------- Report a problem ----------

export function ReportProblemScreen() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const [category, setCategory] = useState<SupportCategory>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const ready = message.trim().length >= MIN;

  async function send() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createSupportTicket({ category, message: message.trim() });
      qc.invalidateQueries({ queryKey: settingsKeys.supportTickets() });
      setSent(true);
    } catch (e) {
      setError(errorText(e, t, 'settings2.report.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen header={<TopBar title={t('settings2.report.title')} />}>
        <EmptyView icon="checkmark-circle-outline" title={t('settings2.report.sentTitle')} sub={t('settings2.report.sentBody')} />
        <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const tone = isDark ? colors.primary2 : colors.primary;

  return (
    <Screen header={<TopBar title={t('settings2.report.title')} />} contentStyle={styles.content}>
      <Note>{t('settings2.report.note')}</Note>
      <AppText variant="label" style={styles.h} accessibilityRole="header">
        {t('settings2.report.kind')}
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('settings2.report.kind')}>
        {CATEGORIES.map((c) => {
          const on = c === category;
          return (
            <Pressable
              key={c}
              onPress={() => {
                tick();
                setCategory(c);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={[
                styles.chip,
                { borderColor: on ? tone : colors.border, backgroundColor: on ? colors.primarySoft : colors.bg2 },
              ]}
            >
              <Text style={{ color: on ? tone : colors.text, fontWeight: on ? '700' : '500', fontSize: 14 }}>
                {t(`settings2.report.cat_${c}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <AppText variant="label" style={styles.h} accessibilityRole="header">
        {t('settings2.report.description')}
      </AppText>
      <TextInput
        value={message}
        onChangeText={(v) => {
          setMessage(v.slice(0, MAX));
          setError(null);
        }}
        multiline
        maxLength={MAX}
        placeholder={t('settings2.report.placeholder')}
        placeholderTextColor={colors.muted}
        accessibilityLabel={t('settings2.report.description')}
        style={[
          styles.textarea,
          { color: colors.text, backgroundColor: colors.bg2, borderColor: colors.border, textAlign: I18nManager.isRTL ? 'right' : 'left' },
        ]}
      />
      <Text style={[styles.count, { color: colors.muted }]}>
        {message.length} / {MAX}
      </Text>
      {!ready && message.length > 0 ? <Note>{t('settings2.report.tooShort', { n: MIN })}</Note> : null}
      <InlineError text={error} />
      <Button title={t('settings2.report.send')} onPress={send} loading={busy} disabled={!ready} style={{ marginTop: 12 }} />
    </Screen>
  );
}

// ---------- Contact us ----------

export function ContactScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [legal, setLegal] = useState(false);
  const tickets = useQuery({ queryKey: settingsKeys.supportTickets(), queryFn: fetchMySupportTickets });

  async function copyEmail() {
    await Clipboard.setStringAsync(SUPPORT_EMAIL).catch(() => {});
    showAlert(t('settings2.contact.copied'));
  }

  async function mail() {
    const url = `mailto:${SUPPORT_EMAIL}`;
    try {
      await Linking.openURL(url);
    } catch {
      // No mail app: the address is on screen and can be copied.
      copyEmail();
    }
  }

  return (
    <Screen header={<TopBar title={t('settings2.contact.title')} />} contentStyle={styles.content}>
      <Note>{t('settings2.contact.note')}</Note>
      {/* The address as readable, selectable text (Apple 1.2 asks for
          published contact information, not only a mailto link). */}
      <View style={[styles.emailBox, { backgroundColor: colors.bg2 }]}>
        <AppText variant="small" muted>
          {t('settings2.contact.emailLabel')}
        </AppText>
        <Text selectable style={[styles.email, { color: colors.text }]}>
          {SUPPORT_EMAIL}
        </Text>
        <AppText variant="small" muted>
          {t('settings2.contact.promise')}
        </AppText>
      </View>

      <Group>
        <Row icon="flag-outline" label={t('settings2.report.title')} onPress={() => go('/settings/report')} />
        <Row icon="mail-outline" label={t('settings2.contact.emailUs')} onPress={mail} />
        <Row icon="copy-outline" label={t('settings2.contact.copy')} onPress={copyEmail} chevron={false} />
        <Row icon="shield-checkmark-outline" label={t('settings2.guidelines.title')} onPress={() => go('/settings/guidelines')} />
        <Row icon="document-text-outline" label={t('settings2.home.legal')} onPress={() => setLegal(true)} />
      </Group>

      <AppText variant="small" muted style={styles.sectionTitle} accessibilityRole="header">
        {t('settings2.contact.previous')}
      </AppText>
      {tickets.isLoading ? (
        <LoadingView />
      ) : !tickets.data?.length ? (
        <EmptyView icon="flag-outline" title={t('settings2.contact.noTickets')} />
      ) : (
        tickets.data.map((tk) => <TicketRow key={tk.id} ticket={tk} when={timeAgo(tk.created_at, t, i18n.language)} />)
      )}

      <LegalSheet visible={legal} onClose={() => setLegal(false)} />
    </Screen>
  );
}

function TicketRow({ ticket, when }: { ticket: SupportTicket; when: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const done = ticket.status === 'resolved' || ticket.status === 'closed';
  return (
    <View style={[styles.ticket, { backgroundColor: colors.bg2 }]}>
      <View style={styles.ticketHead}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{when}</Text>
        <Text style={{ color: done ? colors.success : colors.warn, fontSize: 12, fontWeight: '700' }}>
          {t(`settings2.contact.status_${ticket.status}`)}
        </Text>
      </View>
      <Text style={{ color: colors.text, fontSize: 14, textAlign: 'left' }} numberOfLines={4}>
        {ticket.message}
      </Text>
      {ticket.admin_reply ? (
        <View style={[styles.reply, { borderStartColor: colors.primary }]}>
          <AppText variant="small" muted>
            {t('settings2.contact.reply')}
          </AppText>
          <Text style={{ color: colors.text, fontSize: 14, textAlign: 'left' }}>{ticket.admin_reply}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------- Community guidelines ----------

export function GuidelinesScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  // The document exists in Arabic and English only.
  const L = i18n.language === 'ar' ? 'ar' : 'en';
  const dir = { writingDirection: L === 'ar' ? 'rtl' : 'ltr' } as const;
  return (
    <Screen header={<TopBar title={t('settings2.guidelines.title')} />}>
      <Text style={[styles.docTitle, { color: colors.text }, dir]} accessibilityRole="header">
        {GUIDELINES_DOC.title[L]}
      </Text>
      {GUIDELINES_DOC.sections.map((s, i) => (
        <View key={i} style={{ marginBottom: 16 }}>
          <Text style={[styles.docH, { color: colors.text }, dir]} accessibilityRole="header">
            {i + 1}. {s.h[L]}
          </Text>
          <Text style={[styles.docP, { color: colors.muted }, dir]}>{s.p[L]}</Text>
        </View>
      ))}
      <Text selectable style={[styles.email, { color: colors.text }]}>
        {SUPPORT_EMAIL}
      </Text>
      <Text style={{ color: colors.muted, marginTop: 18, fontSize: 12 }}>© 2026 FLYP</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  h: { marginTop: 18, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 20, borderWidth: 1 },
  textarea: { minHeight: 150, borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 15, textAlignVertical: 'top' },
  count: { fontSize: 12, marginTop: 6, textAlign: 'right' },
  emailBox: { borderRadius: 14, padding: 16, marginTop: 14, gap: 6 },
  email: { fontSize: 17, fontWeight: '700' },
  sectionTitle: { fontWeight: '700', marginTop: 22, marginBottom: 8, marginHorizontal: 4, textAlign: 'left' },
  ticket: { borderRadius: 14, padding: 14, marginBottom: 10, gap: 6 },
  ticketHead: { flexDirection: 'row', justifyContent: 'space-between' },
  reply: { borderStartWidth: 3, paddingStart: 10, marginTop: 4, gap: 2 },
  docTitle: { fontSize: 22, fontWeight: '800', marginBottom: 14 },
  docH: { fontSize: 15.5, fontWeight: '700', marginBottom: 6 },
  docP: { fontSize: 14.5, lineHeight: 23 },
});
