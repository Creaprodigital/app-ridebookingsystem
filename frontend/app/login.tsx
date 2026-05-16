import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/auth';
import { colors, radius, spacing } from '../src/theme';
import { apiError, forgotPassword } from '../src/api';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const onForgot = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError('Saisissez votre email pour recevoir un lien');
      return;
    }
    setForgotLoading(true);
    try {
      const res = await forgotPassword(email.trim());
      const msg = res?.message || 'Si cet email existe, un lien vous a été envoyé.';
      setInfo(msg);
      if (Platform.OS !== 'web') Alert.alert('Email envoyé', msg);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setForgotLoading(false);
    }
  };

  const onSubmit = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError('Veuillez saisir votre email et mot de passe');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      const msg = apiError(e);
      setError(msg);
      if (Platform.OS !== 'web') Alert.alert('Connexion échouée', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandWrap}>
            <Text style={styles.brandTitle}>Ride Booking</Text>
            <Text style={styles.brandKicker}>System</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Connexion</Text>
            <Text style={styles.subtitle}>Bon retour. Prenez la route.</Text>

            <View style={styles.field}>
              <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
              <TextInput
                testID="login-email-input"
                style={styles.input}
                placeholder="email@exemple.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
              <TextInput
                testID="login-password-input"
                style={styles.input}
                placeholder="Mot de passe"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPwd}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShowPwd((v) => !v)} testID="login-toggle-pwd">
                <Ionicons
                  name={showPwd ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={styles.errorBox} testID="login-error">
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {info ? (
              <View style={styles.infoBox} testID="login-info">
                <Ionicons name="mail" size={16} color={colors.success} />
                <Text style={styles.infoText}>{info}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              testID="login-submit-button"
              style={[styles.submit, loading && { opacity: 0.7 }]}
              onPress={onSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <>
                  <Text style={styles.submitText}>SE CONNECTER</Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.bg} />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onForgot}
              disabled={forgotLoading}
              style={styles.forgotBtn}
              testID="login-forgot-button"
            >
              {forgotLoading ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.hint}>
              Votre compte est créé par votre flotte. Contactez votre opérateur si besoin.
            </Text>
          </View>

          <Text style={styles.footer}>© {new Date().getFullYear()} Ride Booking System</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  brandWrap: { alignItems: 'center', marginBottom: spacing.xl },
  logoDot: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 0 },
    marginBottom: spacing.md,
  },
  brandTitle: { color: colors.text, fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  brandKicker: {
    color: colors.primary, fontSize: 12, fontWeight: '800',
    letterSpacing: 4, textTransform: 'uppercase', marginTop: 2,
  },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: -8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 52,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '500' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#EF444420', borderColor: colors.danger, borderWidth: 1,
    borderRadius: radius.md, padding: spacing.sm,
  },
  errorText: { color: colors.danger, flex: 1, fontSize: 13, fontWeight: '600' },
  infoBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#22C55E20', borderColor: colors.success, borderWidth: 1,
    borderRadius: radius.md, padding: spacing.sm,
  },
  infoText: { color: colors.success, flex: 1, fontSize: 13, fontWeight: '600' },
  forgotBtn: { alignItems: 'center', paddingVertical: 8 },
  forgotText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  submit: {
    height: 56, backgroundColor: colors.primary, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm,
    marginTop: spacing.sm,
  },
  submitText: { color: colors.bg, fontWeight: '900', fontSize: 15, letterSpacing: 1.2 },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  footer: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.xl },
});
