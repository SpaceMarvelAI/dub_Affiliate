import { getProgram } from "@/lib/fetchers/get-program";
import LoginForm from "@/ui/auth/login/login-form";
import { AuthLayout } from "@/ui/layout/auth-layout";
import { cn, constructMetadata } from "@dub/utils";
import { redirect } from "next/navigation";

export const metadata = constructMetadata({
  fullTitle: "Login to partners.dub.co",
});

export default async function LoginPage(props: {
  params: Promise<{ programSlug?: string }>;
}) {
  const { programSlug } = await props.params;

  const program = programSlug ? await getProgram({ slug: programSlug }) : null;

  if (programSlug && !program) {
    redirect("/login");
  }

  return (
    <div className="relative w-full">
      <AuthLayout showTerms="partners" className={cn(programSlug && "pt-20")}>
        <div className="w-full max-w-sm">
          <h1 className="text-center text-xl font-semibold">
            Log in to your Space Marvel Partner account
          </h1>
          <div className="mt-8">
            <LoginForm next={programSlug ? `/programs/${programSlug}` : "/"} />
          </div>
        </div>
      </AuthLayout>
    </div>
  );
}
