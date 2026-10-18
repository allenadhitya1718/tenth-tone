import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet } from 'react-native';

import { fetchDataExports, requestDataExport, settingsKeys, type DataExport } from '@/api/settings';
import { Button, Screen, TopBar } from '@/components/ui';
import { timeAgo } from '@/lib/timeAgo';

import { ErrorView, Group, LoadingView, Note, Row, showError } from './components';

export function DataExportScreen() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const exports = useQuery({ queryKey: settingsKeys.dataExports(), queryFn: fetchDataExports });
  const pending = (exports.data ?? []).some((x) => x.status === 'pending');

  const req = useMutation({
    mutationFn: requestDataExport,
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.dataExports() }),
    onError: (e) => showError(t, e, 'settings2.data.requestFailed'),
  });

  const statusText = (x: DataExport) =>
    x.status === 'ready'
      ? t('settings2.data.ready')
      : x.status === 'failed'
        ? t('settings2.data.failed')
        : t('settings2.data.pending');

  return (
    <Screen header={<TopBar title={t('settings2.data.title')} />} contentStyle={styles.content}>
      <Note>{t('settings2.data.note')}</Note>
      <Button
        title={pending ? t('settings2.data.requested') : t('settings2.data.request')}
        onPress={() => req.mutate()}
        loading={req.isPending}
        disabled={pending || exports.isLoading}
        style={{ marginTop: 14 }}
      />

      {exports.isLoading ? (
        <LoadingView />
      ) : exports.isError ? (
        <ErrorView onRetry={() => exports.refetch()} />
      ) : exports.data?.length ? (
        <Group title={t('settings2.data.history')}>
          {exports.data.map((x) => (
            <Row
              key={x.id}
              icon={x.status === 'ready' ? 'document-attach-outline' : x.status === 'failed' ? 'alert-circle-outline' : 'hourglass-outline'}
              label={statusText(x)}
              hint={timeAgo(x.requested_at, t, i18n.language)}
              value={x.status === 'ready' && x.file_url ? t('settings2.data.open') : undefined}
              onPress={x.status === 'ready' && x.file_url ? () => Linking.openURL(x.file_url as string).catch(() => {}) : undefined}
            />
          ))}
        </Group>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 16, paddingBottom: 40 } });
