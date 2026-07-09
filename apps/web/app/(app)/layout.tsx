import Sidebar from '@/src/components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 lg:pl-64">
        <div className="min-h-screen">{children}</div>
      </main>
    </div>
  );
}
