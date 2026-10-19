import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  I18nManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/providers/ThemeProvider';

type TextVariant = 'title' | 'subtitle' | 'body' | 'label' | 'small';

export function AppText({
  variant = 'body',
  muted,
  center,
  style,
  ...rest
}: TextProps & { variant?: TextVariant; muted?: boolean; center?: boolean }) {
  const { colors } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        styles[variant],
        { color: muted ? colors.muted : colors.text },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}

// Safe area + keyboard avoidance + scroll, which every form screen needs.
export function Screen({
  children,
  header,
  scroll = true,
  contentStyle,
}: {
  children: ReactNode;
  header?: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.screenContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenContent, { flex: 1 }, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function TopBar({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
      <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
        {/* The chevron points the way "back" goes, which flips in RTL. */}
        <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.text} />
      </Pressable>
      <AppText variant="label" style={styles.topBarTitle} numberOfLines={1}>
        {title}
      </AppText>
      <View style={{ minWidth: 26 }}>{right}</View>
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  style,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, isDark } = useTheme();
  const off = disabled || loading;
  // Brand blue as text on navy is too dark to read; the lighter tone is used
  // for text on the secondary and ghost buttons in dark mode.
  const tint = isDark ? colors.primary2 : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
        variant === 'secondary' && { backgroundColor: colors.primarySoft },
        variant === 'ghost' && { backgroundColor: 'transparent' },
        off && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : tint} /> : null}
      <Text
        style={[
          styles.buttonText,
          { color: variant === 'primary' ? colors.onPrimary : tint },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function TextField({ secure, style, ...rest }: TextInputProps & { secure?: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(true);
  return (
    <View style={[styles.field, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
      <TextInput
        placeholderTextColor={colors.muted}
        {...rest}
        secureTextEntry={secure ? hidden : false}
        style={[styles.fieldInput, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }, style]}
      />
      {secure ? (
        <Pressable
          onPress={() => setHidden((h) => !h)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={hidden ? t('password.show') : t('password.hide')}
        >
          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// Errors are kept as a translation key, not a string, so a message already
// on screen follows a language switch.
export type ErrorMsg = { key: string; params?: Record<string, unknown> } | null;

export function ErrorBox({ error }: { error?: ErrorMsg }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (!error) return null;
  const message = t(error.key, error.params);
  return (
    <View style={[styles.errorBox, { backgroundColor: colors.dangerSoft }]} accessibilityLiveRegion="polite">
      <AppText variant="small" style={{ color: colors.danger }}>
        {message}
      </AppText>
    </View>
  );
}

export function LinkText({ title, onPress, disabled, style }: { title: string; onPress: () => void; disabled?: boolean; style?: StyleProp<TextStyle> }) {
  const { colors, isDark } = useTheme();
  // Brand blue as text on navy only reaches ~4.3:1; the lighter tone clears 4.5:1.
  const tone = isDark ? colors.primary2 : colors.primary;
  return (
    <Text
      onPress={disabled ? undefined : onPress}
      accessibilityRole="link"
      style={[styles.link, { color: disabled ? colors.muted : tone }, style]}
    >
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', marginBottom: 6 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 16, fontWeight: '700' },
  small: { fontSize: 13, lineHeight: 19 },
  screenContent: { flexGrow: 1, paddingHorizontal: 22, paddingVertical: 16 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarTitle: { flex: 1, textAlign: 'center' },
  button: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginVertical: 6,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 12,
  },
  fieldInput: { flex: 1, fontSize: 16, height: '100%' },
  errorBox: { borderRadius: 12, padding: 12, marginBottom: 12 },
  link: { fontSize: 14, fontWeight: '700' },
});
