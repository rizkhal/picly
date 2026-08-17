import { StyleSheet, View } from 'react-native';
import type { Icon } from 'phosphor-react-native';
import {
  Gear,
  House,
  MagnifyingGlass,
  UsersThree,
} from 'phosphor-react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList, RootTabParamList } from './types';
import { colors, radius, spacing } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { OnboardingScreen } from '../ui/screens/OnboardingScreen';
import { AuthScreen } from '../ui/screens/AuthScreen';
import { PhotosScreen } from '../ui/screens/PhotosScreen';
import { PeopleScreen } from '../ui/screens/PeopleScreen';
import { SearchScreen } from '../ui/screens/SearchScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { ScanProgressScreen } from '../ui/screens/ScanProgressScreen';
import { PersonDetailScreen } from '../ui/screens/PersonDetailScreen';
import { PhotoDetailScreen } from '../ui/screens/PhotoDetailScreen';
import { Spinner } from '../ui/components/Spinner';

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TABS: Array<{ name: keyof RootTabParamList; label: string; icon: Icon }> = [
  { name: 'PhotosTab', label: 'Photos', icon: House },
  { name: 'PeopleTab', label: 'People', icon: UsersThree },
  { name: 'SearchTab', label: 'Search', icon: MagnifyingGlass },
  { name: 'SettingsTab', label: 'Settings', icon: Gear },
];

const TAB_COMPONENTS: Record<keyof RootTabParamList, React.ComponentType> = {
  PhotosTab: PhotosScreen,
  PeopleTab: PeopleScreen,
  SearchTab: SearchScreen,
  SettingsTab: SettingsScreen,
};

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map(({ name, label, icon: IconComponent }) => (
        <Tab.Screen
          key={name}
          name={name}
          component={TAB_COMPONENTS[name]}
          options={{
            tabBarLabel: label,
            tabBarIcon: ({ color, focused }) => (
              <IconComponent size={focused ? 24 : 22} color={color} weight={focused ? 'fill' : 'regular'} />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

function AuthFlow() {
  const { user } = useAuth();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <Stack.Screen name="Main" component={TabNavigator} />
      ) : (
        <>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Auth" component={AuthScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

export function RootNavigator() {
  const { ready } = useAuth();

  if (!ready) {
    return (
      <View style={styles.loading}>
        <Spinner size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AuthFlow" component={AuthFlow} />
      <Stack.Screen name="ScanProgress" component={ScanProgressScreen} />
      <Stack.Screen name="PersonDetail" component={PersonDetailScreen} />
      <Stack.Screen name="PhotoDetail" component={PhotoDetailScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
