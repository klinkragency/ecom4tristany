import SettingsModal from './SettingsModal';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsModal>{children}</SettingsModal>;
}
