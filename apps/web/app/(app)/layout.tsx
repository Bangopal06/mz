import Sidebar from '@/src/components/Sidebar';
import BroadcastNotifier from '@/src/components/BroadcastNotifier';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <BroadcastNotifier />
      <main className="flex-1 lg:pl-64">
        <div className="min-h-screen">{children}</div>
      </main>
    </div>
  );
}
