import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  FormTextInput,
  formStyles,
  KeyboardAwareForm,
  Segmented,
  SubmitButton,
  useSubmitGuard,
} from './form';
import { CATEGORY_ICON_OPTIONS, Icon } from './Icon';
import { colors, radii } from '@/theme';

export type CategoryType = 'expense' | 'income';

export interface CategoryFormValues {
  name: string;
  icon: string;
  type: CategoryType;
}

interface Props {
  initial?: Partial<CategoryFormValues>;
  /** Type is fixed once a category exists — expense/income can't flip. */
  lockType?: boolean;
  submitLabel?: string;
  onSubmit: (values: CategoryFormValues) => void | Promise<void>;
}

/** Shared fields for the add/edit category modals. */
export function CategoryForm({ initial, lockType = false, submitLabel = 'Save', onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'tag');
  const [type, setType] = useState<CategoryType>(initial?.type ?? 'expense');

  const valid = name.trim() !== '';

  const [submitting, submit] = useSubmitGuard(async () => {
    if (!valid) return;
    await onSubmit({ name: name.trim(), icon, type });
  });

  return (
    <KeyboardAwareForm>
      {!lockType && (
        <Segmented
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
          value={type}
          onChange={setType}
        />
      )}

      <Text style={formStyles.label}>Name</Text>
      <FormTextInput
        style={formStyles.textInput}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Groceries"
        placeholderTextColor={colors.inkFaint}
        returnKeyType="done"
        testID="category-name"
      />

      <Text style={formStyles.label}>Icon</Text>
      <View style={formStyles.chipRow}>
        {CATEGORY_ICON_OPTIONS.map((key) => {
          const selected = key === icon;
          return (
            <Pressable
              key={key}
              onPress={() => setIcon(key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Icon ${key}`}
              testID={`category-icon-${key}`}
              style={{
                width: 44,
                height: 44,
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: selected ? colors.gold : colors.border,
                backgroundColor: selected ? colors.surfaceRaised : colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={key} size={20} color={selected ? colors.gold : colors.inkDim} />
            </Pressable>
          );
        })}
      </View>

      <SubmitButton
        label={submitLabel}
        disabled={!valid}
        submitting={submitting}
        onPress={submit}
      />
    </KeyboardAwareForm>
  );
}
