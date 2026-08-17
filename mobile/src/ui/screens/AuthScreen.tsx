import { forwardRef, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { EnvelopeSimple, LockKey, User } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme';
import { ScreenSafeArea } from '../components/ScreenSafeArea';
import { Spinner } from '../components/Spinner';
import type { Icon } from 'phosphor-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

type Mode = 'login' | 'register';

interface FieldProps extends TextInputProps {
  icon: Icon;
}

const Field = forwardRef<TextInput, FieldProps>(function Field(
  { icon: IconComponent, style, ...rest }: FieldProps,
  ref,
) {
  return (
    <View style={styles.field}>
      <IconComponent size={18} color={colors.textFaint} />
      <TextInput ref={ref} style={[styles.input, style]} {...rest} />
    </View>
  );
});

/**
 * Login / register screen. Local-first stub for now — any credentials create a
 * local session via AuthContext. Swap with the real backend client later.
 */
export function AuthScreen({ navigation }: Props) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <ScreenSafeArea>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <View style={styles.logoWrap}>
              <Image source={require('../../../assets/logo-128.png')} style={styles.logoImg} />
            </View>
            <Text style={styles.brandName}>Picly</Text>
            <Text style={styles.brandTagline}>Sign in to keep your faces organized</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.seg}>
              {(['login', 'register'] as Mode[]).map((m) => (
                <Pressable
                  key={m}
                  style={[styles.segBtn, mode === m && styles.segBtnActive]}
                  onPress={() => switchMode(m)}
                >
                  <Text style={[styles.segLabel, mode === m && styles.segLabelActive]}>
                    {m === 'login' ? 'Log in' : 'Create account'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === 'register' ? (
              <Field
                icon={User}
                placeholder="Name"
                autoCapitalize="words"
                autoComplete="name"
                autoCorrect={false}
                returnKeyType="next"
                value={name}
                onChangeText={setName}
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            ) : null}

            <Field
              ref={emailRef}
              icon={EnvelopeSimple}
              placeholder="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => passwordRef.current?.focus()}
            />

            <Field
              ref={passwordRef}
              icon={LockKey}
              placeholder="Password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]} onPress={submit} disabled={busy}>
              {busy ? (
                <Spinner size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryLabel}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>
              )}
            </Pressable>

            <Pressable onPress={() => navigation.goBack()} hitSlop={8} disabled={busy}>
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: spacing.xxl,
  },
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  logoImg: {
    width: 72,
    height: 72,
  },
  brandName: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  brandTagline: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  form: {
    gap: spacing.md,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 3,
    marginBottom: spacing.sm,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  segBtnActive: {
    backgroundColor: colors.surface2,
  },
  segLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  segLabelActive: {
    color: colors.text,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  backLabel: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
});
