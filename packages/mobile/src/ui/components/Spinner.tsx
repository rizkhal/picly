import { ActivityIndicator } from 'react-native';
import { colors } from '../../theme';

interface Props {
  size?: 'small' | 'large';
  color?: string;
}

export function Spinner({ size = 'small', color = colors.accent }: Props) {
  return <ActivityIndicator size={size} color={color} />;
}
