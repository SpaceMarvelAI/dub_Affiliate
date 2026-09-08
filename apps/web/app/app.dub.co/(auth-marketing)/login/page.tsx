import LoginForm from "@/ui/auth/login/login-form";
import { AuthLayout } from "@/ui/layout/auth-layout";
import { APP_DOMAIN, constructMetadata } from "@dub/utils";

export const metadata = constructMetadata({
  title: "Sign in to Space Marvel",
  canonicalUrl: `${APP_DOMAIN}/login`,
});

export default function LoginPage() {
  return (
    <AuthLayout showTerms="app">
      <div className="w-full max-w-sm">
        <h3 className="text-center text-xl font-semibold">
          Log in to your Space Marvel account
        </h3>
        <div className="mt-8">
          <LoginForm />
        </div>
      </div>
    </AuthLayout>
  );
}
