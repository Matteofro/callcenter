import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

// Next.js 15 requires useSearchParams() to be inside a <Suspense> boundary,
// otherwise the page fails to prerender. The form is the client island; this
// page is the server wrapper.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
