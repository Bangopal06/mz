'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/src/lib/supabase/client';

interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        supabase
          .from('users')
          .select('id, email, full_name, role')
          .eq('auth_user_id', session.user.id)
          .single()
          .then(({ data }) => {
            setUser(data as AuthUser | null);
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    });
  }, []);

  return { user, loading };
}
