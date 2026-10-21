import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { BirthDateField } from '@/components/BirthDateField';
import { LegalSheet } from '@/components/LegalSheet';
import { PasswordRules } from '@/components/PasswordRules';
import { AppText, Button, ErrorBox, Screen, TextField, TopBar, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';
import { cleanHandle, useHandleCheck, type HandleState } from '@/hooks/useHandleCheck';
import { isHandleAvailable, signUp } from '@/lib/auth';
import { MIN_AGE } from '@/lib/config';
import { ageOn, isCommonPassword, isEmail, passwordChecks } from '@/lib/password';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

const HANDLE_HINT: Record<HandleState, string> = {
  empty: 'register.handleRule',
  bad: 'register.handleShort',
  checking: 'register.handleChecking',
  taken: 'register.handleTaken',
  free: 'register.handleFree',
};

// Three steps. The username is asked for rather than generated (everyone used
// to end up as @user_d6aceb49), and the birthday is OPTIONAL: Apple rejected
// 1.0 under 5.1.1(v) for requiring it. The 13+ gate is the agreement box on
// step 3; a birthday, when given, is still checked.
export default function Register() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { setPending } = useAuth();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [birth, setBirth] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [legal, setLegal] = useState(false);
  const [error, setError] = useState<ErrorMsg>(null);
  const [busy, setBusy] = useState(false);
  const handleState = useHandleCheck(handle);

  const go = (i: number) => {
    setError(null);
    setStep(i);
  };

  async function next1() {
    const n = name.trim();
    if (n.length < 2) return setError({ key: 'register.enterName' });
    if (handle.length < 3) return setError({ key: 'register.enterHandle' });
    if (handleState === 'taken') return setError({ key: 'register.handleTakenPick' });
    // Required (owner request): the 18+ location check and the age minimum
    // both read it, and it cannot be added to a profile by anyone else.
    if (!birth) return setError({ key: 'register.birthRequired' });
    const age = ageOn(birth);
    if (age == null || age > 120) return setError({ key: 'register.badBirth' });
    if (age < MIN_AGE) return setError({ key: 'errors.tooYoung' });
    // Moved faster than the debounce: settle it before going on.
    if (handleState === 'checking') {
      try {
        if (!(await isHandleAvailable(handle))) return setError({ key: 'register.handleTakenPick' });
      } catch {}
    }
    setName(n);
    go(1);
  }

  function next2() {
    if (!isEmail(email)) return setError({ key: 'register.badEmail' });
    go(2);
  }

  async function create() {
    if (isCommonPassword(password)) return setError({ key: 'password.common' });
    setError(null);
    setBusy(true);
    try {
      const addr = email.trim();
      const { alreadyRegistered } = await signUp({ email: addr, password, name, handle });
      if (alreadyRegistered) {
        setError({ key: 'register.alreadyRegistered' });
      } else {
        setPending({ signupEmail: addr, birthDate: birth || undefined });
        router.replace('/otp');
        return;
      }
    } catch (e) {
      setError(toErrorMsg(e));
    }
    setBusy(false);
  }

  const canCreate = passwordChecks(password).every((c) => c.ok) && confirm === password && !!password && agreed;
  const hintColor =
    handleState === 'free' ? colors.success : handleState === 'taken' || handleState === 'bad' ? colors.danger : colors.muted;

  return (
    <Screen
      header={
        <>
          <TopBar title={t('register.title')} onBack={() => (step > 0 ? go(step - 1) : router.replace('/welcome'))} />
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 22, paddingTop: 12 }}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.primary : colors.bg3 }}
              />
            ))}
          </View>
        </>
      }
    >
      {step === 0 ? (
        <>
          <AppText variant="title">{t('register.step1Title')}</AppText>
          <AppText variant="subtitle" muted>
            {t('register.step1Sub')}
          </AppText>
          <ErrorBox error={error} />
          <TextField value={name} onChangeText={setName} placeholder={t('register.name')} maxLength={40} autoComplete="name" />
          <TextField
            value={handle}
            onChangeText={(v) => setHandle(cleanHandle(v))}
            placeholder={t('register.handle')}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
          />
          <AppText variant="small" style={{ color: hintColor, marginTop: -6, marginBottom: 12 }}>
            {t(HANDLE_HINT[handleState])}
          </AppText>
          <AppText variant="small" style={{ fontWeight: '700', marginBottom: 6 }}>
            {t('register.birthLabel')}
          </AppText>
          <BirthDateField value={birth} onChange={setBirth} />
          <AppText variant="small" muted style={{ marginBottom: 16 }}>
            {t('register.birthHint')}
          </AppText>
          <Button title={t('common.next')} onPress={next1} />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <AppText variant="title">{t('register.step2Title')}</AppText>
          <AppText variant="subtitle" muted>
            {t('register.step2Sub')}
          </AppText>
          <ErrorBox error={error} />
          <TextField
            value={email}
            onChangeText={setEmail}
            placeholder={t('register.email')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={next2}
          />
          <Button title={t('common.next')} onPress={next2} />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <AppText variant="title">{t('register.step3Title')}</AppText>
          <AppText variant="subtitle" muted>
            {t('register.step3Sub')}
          </AppText>
          <ErrorBox error={error} />
          <TextField
            value={password}
            onChangeText={setPassword}
            placeholder={t('login.password')}
            secure
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <PasswordRules value={password} />
          <TextField
            value={confirm}
            onChangeText={setConfirm}
            placeholder={t('register.confirmPlaceholder')}
            secure
            autoComplete="new-password"
            textContentType="newPassword"
          />
          {/* A real agreement (App Review 1.2: terms with zero tolerance for
              objectionable content), not a sentence about one. */}
          <Pressable
            onPress={() => setAgreed((a) => !a)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginVertical: 10 }}
          >
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? colors.primary : colors.muted} />
            <Text style={{ flex: 1, color: colors.muted, fontSize: 13, lineHeight: 20 }}>
              {t('register.agreePrefix')}{' '}
              {/* Reading the terms must not tick the box. */}
              <Text style={{ color: colors.primary2, fontWeight: '700' }} onPress={() => setLegal(true)} suppressHighlighting>
                {t('legal.termsAndPrivacy')}
              </Text>
              {t('register.agreeSuffix')}
            </Text>
          </Pressable>
          <Button
            title={busy ? t('register.creating') : t('register.create')}
            loading={busy}
            disabled={!canCreate}
            onPress={create}
          />
        </>
      ) : null}
      <LegalSheet visible={legal} onClose={() => setLegal(false)} />
    </Screen>
  );
}
