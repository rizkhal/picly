import { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { X } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Face } from '../../types';
import { colors, radius, spacing } from '../../theme';
import { QualityBadge } from './QualityBadge';
import { Spinner } from './Spinner';

interface Props {
  face: Face | null;
  photoUri: string;
  /** All people available for assignment. */
  peopleNames: string[];
  visible: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
  onUnassign: () => void;
  onAssign: (personName: string) => void;
}

/**
 * Bottom sheet shown when tapping a face box in PhotoDetail.
 * Large crop, inline rename, assign/unassign. Unassign sets the name back to
 * null (desktop semantics) — it does NOT delete the face.
 */
export function FaceSheet({
  face,
  photoUri,
  peopleNames,
  visible,
  onClose,
  onRename,
  onUnassign,
  onAssign,
}: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');

  if (!face) return null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Face</Text>
            <View style={styles.headerRight}>
              <QualityBadge tier={face.quality} />
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
                <X size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          <Image source={{ uri: face.thumbnailUri }} style={styles.crop} resizeMode="cover" />

          <View style={styles.row}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={face.name ?? 'Unassigned'}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="words"
            />
            <Pressable style={styles.primaryBtn} onPress={() => onRename(draft)}>
              <Text style={styles.primaryBtnLabel}>Rename</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>ASSIGN TO</Text>
          <View style={styles.peopleList}>
            {peopleNames.map((name) => (
              <Pressable
                key={name}
                style={styles.personRow}
                onPress={() => onAssign(name)}
              >
                <View style={styles.avatar} />
                <Text style={styles.personName}>{name}</Text>
                <Text style={styles.assignAction}>Assign</Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.dangerBtn} onPress={onUnassign}>
            <Text style={styles.dangerBtnLabel}>Remove from person</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crop: {
    width: '100%',
    height: 220,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: spacing.xs,
  },
  peopleList: {
    gap: spacing.xs,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
  },
  personName: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  assignAction: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  dangerBtn: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dangerBtnLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
  },
});
