import { redirect } from 'next/navigation';

// Settings is rendered as a modal; the rail handles navigation between
// sub-sections. The bare /settings URL just lands on General.
export default function SettingsIndex() {
  redirect('/settings/general');
}
