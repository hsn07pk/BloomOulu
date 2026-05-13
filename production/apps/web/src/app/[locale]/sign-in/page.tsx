import { signInAction } from './actions';

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <main>
      <h1>Sign in</h1>
      <p>We'll email you a one-tap sign-in link. No password.</p>
      <form action={signInAction}>
        <input type="hidden" name="locale" value={locale} />
        <label>Email <input type="email" name="email" required autoComplete="email" /></label>
        <button type="submit">Send link</button>
      </form>
    </main>
  );
}
