'use client';

/**
 * BroadcastNotifier
 * Subscribes to broadcast_jobs postgres_changes and shows a toast
 * when a broadcast transitions to 'completed' or 'failed'.
 *
 * Requirements: 1.7, 8.3
 */

import { useEffect } from 'react';
import { createClient } from '@/src/lib/supabase/client';
import { showToast } from '@/src/components/Toast';

interface BroadcastUpdate {
  id: string;
  title: string;
  status: string;
}

export default function BroadcastNotifier() {
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('broadcast_notifier')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'broadcast_jobs' },
        (payload) => {
          const job = payload.new as BroadcastUpdate;
          if (job.status === 'completed') {
            showToast(`Broadcast "${job.title}" selesai dikirim`, 'success');
          } else if (job.status === 'failed') {
            showToast(`Broadcast "${job.title}" gagal`, 'error');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // This component renders nothing — it only subscribes for side effects
  return null;
}
