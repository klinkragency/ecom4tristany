import PasswordChangeGate from './PasswordChangeGate';
import Chrome from './_chrome/Chrome';

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PasswordChangeGate />
      <Chrome>{children}</Chrome>
    </>
  );
}
