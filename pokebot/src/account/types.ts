export interface Account {
  id: string;
  loginId: string;
  loginType: 'phone';
  proxy: {
    host: string;
    port: number;
    username: string;
    password: string;
  } | null;
  paymentLabel: string;
  createdAt: string;
  lastLoginAt: string | null;
  sessionFile: string | null;
}
