import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert, Image } from 'react-native';
import { Text, TextInput } from '../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../src/auth';
import { colors, radius, spacing, isDark } from '../src/theme';
import { apiError, forgotPassword } from '../src/api';

const LOGO = isDark
  ? require('../assets/images/logo-horizontal-dark.png')
  : require('../assets/images/logo-horizontal.png');

export default function Login() {
  const { signIn } = useAuth();
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            {router.canGoBack() ? (
              <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="login-back">
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </TouchableOpacity>
            ) : null}
          </View>

          <Image source={LOGO} style={styles.logo} resizeMode="contain" />

          <Text style={styles.title}>Connexion</Text>
          <Text style={styles.subtitle}>
            {role === 'pro'
              ? 'Accédez à votre espace professionnel.'
              : role === 'driver'
              ? 'Accédez à votre espace chauffeur.'
              : 'Accédez à votre espace RideBookingSystem.'}
          </Text>

          <Text style={styles.label}>Adresse e-mail</Text>
          <View style={styles.field}>
            <Ionicons name="mail-outline" size={19} color={colors.textMuted} />
            <TextInput
              testID="login-email-input"
              style={styles.input}
              placeholder="email@exemple.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <Text style={styles.label}>Mot de passe</Text>
          <View style={styles.field}>
            <Ionicons name="lock-closed-outline" size={19} color={colors.textMuted} />
            <TextInput
              testID="login-password-input"
              style={styles.input}
              placeholder="Votre mot de passe"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPwd}
              autoComplete="password"
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={onSubmit}
            />
            <TouchableOpacity
              onPress={() => setShowPwd((v) => !v)}
              testID="login-toggle-pwd"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            >
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

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

          {error ? (
            <View style={styles.errorBox} testID="login-error">
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {info ? (
            <View style={styles.infoBox} testID="login-info">
              <Ionicons name="mail" size={18} color={colors.success} />
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
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.submitText}>Se connecter</Text>
            )}
          </TouchableOpacity>

          <View style={{ flex: 1 }} />
          <Text style={styles.hint}>
            Votre compte est créé par votre flotte.{'\n'}Besoin d’aide ? Contactez votre opérateur.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  topRow: { height: 52, justifyContent: 'center' },
  backBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  logo: { width: 240, height: 32, marginTop: spacing.lg, marginBottom: spacing.xl },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 16, marginTop: 6, marginBottom: spacing.lg },
  label: { color: colors.textSecondary, fontSize: 13.5, fontWeight: '600', marginBottom: 8, marginTop: 8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 56, marginBottom: 8,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '500', height: '100%' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 12, marginBottom: 12,
  },
  errorText: { color: colors.danger, flex: 1, fontSize: 14, fontWeight: '600' },
  infoBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.successSoft, borderRadius: radius.md, padding: 12, marginBottom: 12,
  },
  infoText: { color: colors.success, flex: 1, fontSize: 14, fontWeight: '600' },
  forgotBtn: { alignSelf: 'flex-end', paddingVertical: 8, marginBottom: 16 },
  forgotText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  submit: {
    height: 56, backgroundColor: colors.primary, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16.5 },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: spacing.xl },
});
