'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, Lock, User, ArrowRight } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { Alert, Button, Card, Input, Label } from '@/components/ui';
import { readJson } from '@/lib/utils/http';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      }

      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-canvas transition-colors relative">
      {/* Top-right Theme Toggle */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>

      <Card className="max-w-md w-full p-6 sm:p-8">
        <div className="text-center mb-6 sm:mb-7">
          <div className="w-11 h-11 bg-accent text-accent-fg rounded-control flex items-center justify-center mx-auto mb-3.5">
            <Wallet className="w-5 h-5" />
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-ink tracking-tight">
            เข้าสู่ระบบ นับตังค์
          </h1>
          <p className="text-xs text-ink-muted font-medium mt-1">
            ระบบจัดการรายรับ-รายจ่ายและการเงินส่วนบุคคล
          </p>
        </div>

        {error && (
          <div className="mb-5">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <Label htmlFor="login-username">ชื่อผู้ใช้ (Username)</Label>
            <div className="relative">
              <User className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                id="login-username"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="pl-9"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="login-password">รหัสผ่าน (Password)</Label>
            <div className="relative">
              <Lock className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="กรอกรหัสผ่าน"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-ink-muted mt-1.5">
              ค่าเริ่มต้น:{' '}
              <span className="font-mono font-medium text-ink-secondary">nubtang1234</span>
            </p>
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={loading}
            className="w-full min-h-11 mt-2 text-sm"
          >
            <span>{loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}
