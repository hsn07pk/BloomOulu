import { signInAction } from './actions.js';

export default function SignInPage({ params }: { params: { locale: string } }) {
  return (
    <main>
      <h1>Sign in</h1>
      <p>We'll email you a one-tap sign-in link. No password.</p>
      <form action={signInAction}>
        <input type="hidden" name="locale" value={params.locale} />
        <label>Email <input type="email" name="email" required autoComplete="email" /></label>
        <button type="submit">Send link</button>
      </form>
    </main>
  );
}
