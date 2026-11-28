import { createTheme } from '@mantine/core';
export const themes = ['dark', 'light', 'contrast'];
export const theme = createTheme({
  fontFamily: 'var(--cf-font)',
  fontFamilyMonospace: 'var(--cf-font-mono)',
  defaultRadius: 4,
  spacing: { xs: '8px', sm: '16px', md: '24px', lg: '32px', xl: '48px' },
  primaryColor: 'blue',
  focusRing: 'auto',
  components: {
    Button: { defaultProps: { radius: 4, size: 'sm' } },
    ActionIcon: { defaultProps: { radius: 4, size: 'lg' } },
    Paper: { defaultProps: { radius: 4 } },
    TextInput: { defaultProps: { radius: 4 } },
    NumberInput: { defaultProps: { radius: 4 } },
    Select: { defaultProps: { radius: 4 } },
    Popover: { defaultProps: { radius: 4, shadow: 'md', withinPortal: true } },
    Modal: { defaultProps: { radius: 4, centered: true } },
  },
});
