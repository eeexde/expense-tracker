import { Fraunces_600SemiBold, Fraunces_900Black } from '@expo-google-fonts/fraunces';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { DbProvider } from '@/db/DbProvider';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_900Black,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <DbProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add-transaction" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-transaction" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-recurring" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-recurring" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-installment" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-installment" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-utang" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-utang" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pay-utang" options={{ presentation: 'modal' }} />
        <Stack.Screen name="manage-buckets" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-bucket" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-bucket" options={{ presentation: 'modal' }} />
        <Stack.Screen name="manage-categories" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-category" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-category" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="auto-log" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notification-inbox" options={{ presentation: 'modal' }} />
        <Stack.Screen name="scan-receipt" options={{ presentation: 'fullScreenModal' }} />
      </Stack>
    </DbProvider>
  );
}
