import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../src/theme';

export default function Index() {
  const { user, loading, isPro } = useAuth();
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  return <Redirect href={isPro ? '/(pro)' : '/(tabs)'} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
