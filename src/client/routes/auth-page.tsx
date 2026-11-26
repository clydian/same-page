import { useInputVisibility } from "../platform/use-input-visibility";
import { createDriveHref, loginHref, loginReturn } from "../auth/login-return";
import { joinDrive, resumeDriveEntry, cancelDriveEntry, type DriveEntryResult } from "../auth/drive-entry";
import { invalidateSettingsLifetime, useSettingsLifetime, captureSettingsLifetime } from "../settings/use-settings-lifetime";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from "react-aria-components";
import { useLocation, useNavigate } from "react-router-dom";

import {
  AUTH_OTP_COOLDOWN_SECONDS,
  authFlowResponseSchema,
  authSessionResponseSchema,
  PASSWORD_POLICY,
  socialAuthProvidersResponseSchema,
  type SocialAuthProvider,
} from "../../shared/auth";
import {
  type ChoirSummary,
} from "../../shared/choirs";
import { authClient } from "../auth/auth-client";
import { AppHeader } from "../components/app-header";
import { type AppLocale, useAppLocale, useMessages } from "../../i18n";
import { LanguageSelect } from "../../i18n/language-select";

type AuthView =
  | "identify"
  | "sign-in"
  | "sign-up"
  | "set-password"
  | "verify-password"
  | "choose-password"
  | "password-set"
  | "verify-registration"
  | "request-reset"
  | "reset-password"
  | "join-choir"
  | "join-result";

const SOCIAL_EMAIL_DRAFT_KEY = "same-page:social-auth-email-draft";

export default function AuthPage() {
  const t = useMessages("entry");
  const { locale } = useAppLocale();
  const authPageRef = useInputVisibility("page");
  const navigate = useNavigate();
  const location = useLocation();
  const initialOauthResult = new URLSearchParams(location.search).get("oauth");
  const [view, setView] = useState<AuthView>("identify");
  const [email, setEmail] = useState(readSocialEmailDraft);
  const [hasGoogle, setHasGoogle] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joinChoir, setJoinChoir] = useState<ChoirSummary | null>(null);
  const [submitting, setSubmitting] = useState(initialOauthResult === "complete");
  type RenderMessage = (translate: typeof t) => string;
  const [message, setMessage] = useState<RenderMessage | null>(() =>
    initialOauthResult === "error"
      ? (translate: typeof t) => translate("authOauthFailed")
      : null,
  );
  const showMessage = useCallback((renderMessage: RenderMessage) => {
    setMessage(() => renderMessage);
  }, []);
  const [otpRetryAt, setOtpRetryAt] = useState(0);
  const [otpClock, setOtpClock] = useState(() => Date.now());
  const [socialProviders, setSocialProviders] = useState<SocialAuthProvider[]>([]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousViewRef = useRef<AuthView>(view);
  const oauthCompletionHandledRef = useRef(false);

  useEffect(() => {
    if (previousViewRef.current !== view) {
      titleRef.current?.focus();
      previousViewRef.current = view;
    }
  }, [view]);

  useEffect(() => {
    if (otpRetryAt <= Date.now()) return;

    const timer = setInterval(() => {
      const now = Date.now();
      setOtpClock(now);
      if (now >= otpRetryAt) clearInterval(timer);
    }, 1_000);
    return () => clearInterval(timer);
  }, [otpRetryAt]);

  const otpRetrySeconds = Math.max(
    0,
    Math.ceil((otpRetryAt - otpClock) / 1_000),
  );

  const rememberOtpCooldown = (response: Response) => {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const seconds =
      response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.ceil(retryAfter)
        : response.ok
          ? AUTH_OTP_COOLDOWN_SECONDS
          : 0;
    if (seconds > 0) {
      const now = Date.now();
      setOtpClock(now);
      setOtpRetryAt(now + seconds * 1_000);
    }
    return seconds;
  };

  useEffect(() => {
    let active = true;
    void diagnosticFetch("/api/auth/social-providers", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const parsed = socialAuthProvidersResponseSchema.safeParse(
          await response.json(),
        );
        return parsed.success ? parsed.data.providers : null;
      })
      .then((providers) => {
        if (active && providers) setSocialProviders(providers);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const showPasswordValidation = () => showMessage(t =>
    password.length < PASSWORD_POLICY.minLength
      ? t("authPasswordMinimum", { min: PASSWORD_POLICY.minLength })
      : password !== passwordConfirmation
        ? t("authPasswordsMismatch")
        : t("authPasswordRequirements"),
  );

  const resendButtonLabel = otpRetrySeconds > 0
    ? t("authResendOtpCountdown", { seconds: otpRetrySeconds })
    : t("authResendOtp");

  const identifyEmail = async (event: FormEvent) => {
    event.preventDefault();
    clearSocialEmailDraft();
    setSubmitting(true);
    setMessage(null);
    const response = await postJson(locale, "/api/auth/flow", {
      email: normalizedEmail(email),
    });
    setSubmitting(false);
    if (!response?.ok) {
      showMessage(t =>
        response?.status === 429
          ? t("authRateLimited")
          : t("authContinueFailed"),
      );
      return;
    }

    const parsed = authFlowResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      showMessage(t => t("authContinueFailed"));
      return;
    }
    setHasGoogle(parsed.data.flow === "set-password" && parsed.data.hasGoogle);
    setView(parsed.data.flow);
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const { error } = await authClient.signIn.email({
      email: normalizedEmail(email),
      password,
    });
    if (error) {
      setSubmitting(false);
      showMessage(t => t("authInvalidCredentials"));
      return;
    }
    await finishAuthentication();
    setSubmitting(false);
  };

  const signUp = async (event: FormEvent) => {
    event.preventDefault();
    if (!validPasswordConfirmation(password, passwordConfirmation)) {
      showPasswordValidation();
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const delivery = await postJson(locale, "/api/auth/registration/request-otp", {
      email: normalizedEmail(email),
    });
    setSubmitting(false);
    if (!delivery?.ok) {
      const retryAfter = delivery ? rememberOtpCooldown(delivery) : 0;
      showMessage(t =>
        retryAfter > 0
          ? t("authOtpRetry", { seconds: retryAfter })
          : t("authOtpSendFailed"),
      );
      return;
    }

    rememberOtpCooldown(delivery);
    setView("verify-registration");
    showMessage(t => t("authOtpSent"));
  };

  const verifyRegistration = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const registration = await postJson(locale, "/api/auth/registration/complete", {
      email: normalizedEmail(email),
      otp: otp.trim(),
      password,
    });
    if (!registration?.ok) {
      setSubmitting(false);
      showMessage(t => t("authOtpInvalid"));
      return;
    }
    await finishAuthentication();
    setSubmitting(false);
  };

  const resendRegistrationOtp = async () => {
    setSubmitting(true);
    setMessage(null);
    const delivery = await postJson(locale, "/api/auth/registration/request-otp", {
      email: normalizedEmail(email),
    });
    setSubmitting(false);
    const retryAfter = delivery ? rememberOtpCooldown(delivery) : 0;
    showMessage(t =>
      !delivery?.ok
        ? retryAfter > 0
          ? t("authOtpRetry", { seconds: retryAfter })
          : t("authOtpSendFailed")
        : t("authOtpResent"),
    );
  };

  const requestPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const delivery = await postJson(
      locale,
      "/api/auth/email-otp/request-password-reset",
      {
        email: normalizedEmail(email),
      },
    );
    setSubmitting(false);
    if (!delivery?.ok) {
      const retryAfter = delivery ? rememberOtpCooldown(delivery) : 0;
      showMessage(t =>
        retryAfter > 0
          ? t("authOtpRetry", { seconds: retryAfter })
          : t("authOtpSendFailed"),
      );
      return;
    }
    rememberOtpCooldown(delivery);
    setView("reset-password");
    showMessage(t => t("authResetOtpSent"));
  };

  const resendPasswordResetOtp = async () => {
    setSubmitting(true);
    setMessage(null);
    const delivery = await postJson(
      locale,
      "/api/auth/email-otp/request-password-reset",
      { email: normalizedEmail(email) },
    );
    setSubmitting(false);
    const retryAfter = delivery ? rememberOtpCooldown(delivery) : 0;
    showMessage(t =>
      !delivery?.ok
        ? retryAfter > 0
          ? t("authOtpRetry", { seconds: retryAfter })
          : t("authOtpSendFailed")
        : t("authResetOtpResent"),
    );
  };

  const requestFirstPasswordOtp = async () => {
    setSubmitting(true);
    setMessage(null);
    const delivery = await postJson(locale, "/api/auth/email-otp/request-password-reset", {
      email: normalizedEmail(email),
    });
    setSubmitting(false);
    const retryAfter = delivery ? rememberOtpCooldown(delivery) : 0;
    // A prior accepted request may have lost its response. Keep code entry
    // available during cooldown so that the delivered code can still be used.
    if (delivery?.ok || delivery?.status === 429) {
      setOtp("");
      setView("verify-password");
    }
    showMessage(t => delivery?.ok
      ? t("authOtpSent")
      : retryAfter > 0
        ? t("authOtpRetryAlreadySent", { seconds: retryAfter })
        : t("authOtpSendNetworkError"));
  };

  const verifyFirstPasswordOtp = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const response = await postJson(locale, "/api/auth/email-otp/check-verification-otp", {
      email: normalizedEmail(email), type: "forget-password", otp: otp.trim(),
    });
    setSubmitting(false);
    if (response?.ok) {
      setView("choose-password");
      return;
    }
    showMessage(t => !response || response.status >= 500
      ? t("authOtpVerifyNetworkError")
      : response.status === 429
        ? t("authRateLimited")
        : t("authOtpInvalidOrLimit"));
  };

  const setFirstPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!validPasswordConfirmation(password, passwordConfirmation)) {
      showPasswordValidation();
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const response = await postJson(locale, "/api/auth/email-otp/reset-password", {
      email: normalizedEmail(email), otp: otp.trim(), password,
    });
    // If the response was lost, check the chosen password before retrying an
    // already consumed OTP. A successful login proves that setup completed.
    if (response?.ok || !response || response.status >= 500) {
      const login = await authClient.signIn.email({ email: normalizedEmail(email), password })
        .catch(() => null);
      setSubmitting(false);
      if (login && !login.error) {
        setPassword("");
        setPasswordConfirmation("");
        setOtp("");
        setView("password-set");
        return;
      }
      setView("sign-in");
      showMessage(t => response?.ok
        ? t("authPasswordSetSignIn")
        : t("authPasswordUnknown"));
      return;
    }
    setSubmitting(false);
    if (response.status === 429) {
      showMessage(t => t("authRateLimited"));
      return;
    }
    setView("verify-password");
    showMessage(t => t("authOtpInvalidForSetup"));
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!validPasswordConfirmation(password, passwordConfirmation)) {
      showPasswordValidation();
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const reset = await authClient.emailOtp.resetPassword({
      email: normalizedEmail(email),
      otp: otp.trim(),
      password,
    });
    if (reset.error) {
      setSubmitting(false);
      showMessage(t => t("authOtpInvalidNoReset"));
      return;
    }

    const login = await authClient.signIn.email({
      email: normalizedEmail(email),
      password,
    });
    if (login.error) {
      setSubmitting(false);
      setView("sign-in");
      showMessage(t => t("authPasswordResetSignIn"));
      return;
    }
    await finishAuthentication();
    setSubmitting(false);
  };

  const entryLifetimeRef = useSettingsLifetime();
  const pendingEntryRef = useRef<Promise<DriveEntryResult> | null>(null);
  const returnContext = useMemo(() => loginReturn(location.search), [location.search]);
  const returnTarget = returnContext?.target;
  const returnReader = returnContext?.reader;
  const finishAuthentication = useCallback(async () => {
    const isCurrent = captureSettingsLifetime(entryLifetimeRef);
    const lifecycle = await diagnosticFetch("/api/user/lifecycle").then(async (response) => response.ok ? response.json() : null).catch(() => null);
    if (!isCurrent()) return;
    if (lifecycle?.deletion || lifecycle?.reauthenticated) {
      await navigate("/user/lifecycle");
      return;
    }
    if (returnTarget && (returnTarget === createDriveHref || returnReader?.action === "open" || returnTarget === "/admin" || returnTarget.startsWith("/admin/scores/"))) {
      await navigate(returnTarget, { replace: true });
      return;
    }
    const pending = resumeDriveEntry();
    pendingEntryRef.current = pending;
    const result = await pending;
    if (!isCurrent()) return;
    if (result.kind === "none") {
      await navigate(returnTarget ?? "/", { replace: true, state: returnTarget ? { readerReturn: returnReader } : { startup: true } });
    } else if (result.kind === "enter") {
      const target = returnTarget?.startsWith(`/choirs/${result.choir.id}/`) ? returnTarget : `/choirs/${result.choir.id}`;
      await navigate(target, { replace: Boolean(returnTarget), state: target === returnTarget ? { readerReturn: returnReader } : undefined });
    } else if (result.kind === "display-name") {
      setJoinChoir(result.choir); setView("join-choir");
    } else {
      setView("join-result"); showMessage(() => result.message);
    }
  }, [navigate, entryLifetimeRef, returnTarget, returnReader, showMessage]);

  useEffect(() => {
    const oauthResult = new URLSearchParams(location.search).get("oauth");
    if (!oauthResult || oauthCompletionHandledRef.current) return;
    oauthCompletionHandledRef.current = true;
    const remaining = new URLSearchParams(location.search); remaining.delete("oauth");
    void navigate(`/login${remaining.size ? `?${remaining}` : ""}`, { replace: true });

    if (oauthResult === "error") return;
    if (oauthResult !== "complete") return;

    void confirmAuthenticatedSession()
      .then(async (authenticated) => {
        if (!authenticated) {
          showMessage(t => t("authOauthNoSession"));
          return;
        }
        clearSocialEmailDraft();
        await finishAuthentication();
      })
      .finally(() => setSubmitting(false));
  }, [finishAuthentication, location.search, navigate, showMessage]);

  const startSocialAuthentication = async (provider: SocialAuthProvider) => {
    setSubmitting(true);
    setMessage(null);
    storeSocialEmailDraft(email);
    const callback = returnTarget ? `${loginHref(returnTarget, returnReader)}&oauth=` : "/login?oauth=";
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: `${callback}complete`,
      errorCallbackURL: `${callback}error`,
    });
    if (error) {
      setSubmitting(false);
      showMessage(t => t("authOauthStartFailed"));
    }
  };

  const cancelEntry = async () => {
    invalidateSettingsLifetime(entryLifetimeRef);
    const isCurrent = captureSettingsLifetime(entryLifetimeRef);
    setSubmitting(true);
    if (returnTarget) await pendingEntryRef.current?.catch(() => undefined);
    else await cancelDriveEntry(pendingEntryRef.current);
    if (isCurrent()) await navigate(returnTarget ?? "/", { replace: Boolean(returnTarget), state: returnTarget ? { readerReturn: returnReader } : { home: true } });
  };

  const joinCurrentGuestChoir = async (event: FormEvent) => {
    event.preventDefault();
    if (!joinChoir) return;
    setSubmitting(true);
    setMessage(null);
    const isCurrent = captureSettingsLifetime(entryLifetimeRef);
    const pending = joinDrive({ kind: "guest", choirId: joinChoir.id }, displayName);
    pendingEntryRef.current = pending;
    const result = await pending;
    if (!isCurrent()) return;
    setSubmitting(false);
    if (result.kind === "enter") {
      const target = returnTarget?.startsWith(`/choirs/${result.choir.id}/`) ? returnTarget : `/choirs/${result.choir.id}`;
      await navigate(target, { replace: Boolean(returnTarget), state: target === returnTarget ? { readerReturn: returnReader } : undefined });
    } else if (result.kind === "failed") {
      showMessage(() => result.message);
      if (result.restart) { setJoinChoir(null); setView("join-result"); }
    }
  };

  const changeEmail = () => {
    setView("identify");
    setHasGoogle(false);
    setPassword("");
    setPasswordConfirmation("");
    setOtp("");
    setOtpRetryAt(0);
    setMessage(null);
  };

  const viewPanel = (() => {
    switch (view) {
      case "identify":
        return {
          title: t("authIdentify"),
          form: (
            <Form className="entry-form" onSubmit={identifyEmail}>
              <EmailField value={email} onChange={setEmail} autoFocus />
              <Button type="submit" isDisabled={submitting}>
                {submitting ? t("authContinuing") : t("authContinue")}
              </Button>
            </Form>
          ),
        };
      case "sign-in":
        return {
          title: t("authSignIn"),
          description: t("authSignInDescription"),
          form: (
            <Form className="entry-form" onSubmit={signIn}>
              <EmailSummary email={email} />
              <PasswordField
                label={t("authPassword")}
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                autoFocus
              />
              <Button type="submit" isDisabled={submitting}>
                {submitting ? t("authSigningIn") : t("authSignIn")}
              </Button>
              <Button
                type="button"
                className="text-button"
                onPress={() => {
                  setView("request-reset");
                  setPassword("");
                  setMessage(null);
                }}
              >
                {t("authForgotPassword")}
              </Button>
              <Button type="button" className="text-button" onPress={changeEmail}>
                {t("authChangeEmail")}
              </Button>
            </Form>
          ),
        };
      case "sign-up":
        return {
          title: t("authSignUp"),
          description: t("authSignUpDescription"),
          form: (
            <Form className="entry-form" onSubmit={signUp}>
              <EmailSummary email={email} />
              <PasswordField
                label={t("authPasswordMinLabel", { min: PASSWORD_POLICY.minLength })}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                autoFocus
              />
              <PasswordField
                label={t("authConfirmPassword")}
                value={passwordConfirmation}
                onChange={setPasswordConfirmation}
                autoComplete="new-password"
              />
              <Button type="submit" isDisabled={submitting}>
                {submitting ? t("authSendingOtp") : t("authSendOtp")}
              </Button>
              <Button type="button" className="text-button" onPress={changeEmail}>
                {t("authChangeEmail")}
              </Button>
            </Form>
          ),
        };
      case "verify-registration":
        return {
          title: t("authVerifyEmail"),
          description: t("authVerifyEmailDescription", { email: normalizedEmail(email) }),
          form: (
            <Form className="entry-form" onSubmit={verifyRegistration}>
              <OtpField value={otp} onChange={setOtp} autoFocus />
              <Button type="submit" isDisabled={submitting}>
                {submitting ? t("authVerifyingOtp") : t("authCompleteSignUp")}
              </Button>
              <Button
                type="button"
                className="text-button"
                isDisabled={submitting || otpRetrySeconds > 0}
                onPress={() => void resendRegistrationOtp()}
              >
                {resendButtonLabel}
              </Button>
              <Button type="button" className="text-button" onPress={changeEmail}>
                {t("authChangeEmail")}
              </Button>
            </Form>
          ),
        };
      case "set-password":
        return {
          title: hasGoogle ? t("authSignInGoogle") : t("authSetPassword"),
          description: hasGoogle
            ? t("authSetPasswordGoogleDescription")
            : t("authSetPasswordDescription"),
          form: (
            <div className="entry-form">
              <EmailSummary email={email} />
              {hasGoogle && socialProviders.includes("google") ? (
                <Button className="primary-button" isDisabled={submitting} onPress={() => void startSocialAuthentication("google")}>
                  {t("authContinueGoogle")}
                </Button>
              ) : null}
              <Button className={hasGoogle && socialProviders.includes("google") ? "secondary-button" : "primary-button"}
                isDisabled={submitting} onPress={() => void requestFirstPasswordOtp()}>
                {submitting ? t("authContinuing") : t("authSetPasswordForEmail")}
              </Button>
              <Button className="text-button" isDisabled={submitting} onPress={changeEmail}>{t("authChangeEmail")}</Button>
            </div>
          ),
        };
      case "verify-password":
        return {
          title: t("authVerifyEmail"),
          description: t("authVerifySetPasswordDescription", { email: normalizedEmail(email) }),
          form: (
            <Form className="entry-form" onSubmit={verifyFirstPasswordOtp}>
              <OtpField value={otp} onChange={setOtp} autoFocus />
              <Button type="submit" isDisabled={submitting}>{submitting ? t("authVerifyingOtp") : t("authVerifyEmail")}</Button>
              <Button className="text-button" isDisabled={submitting || otpRetrySeconds > 0}
                onPress={() => void requestFirstPasswordOtp()}>{resendButtonLabel}</Button>
              <Button className="text-button" isDisabled={submitting} onPress={() => {
                setView("set-password"); setMessage(null); setOtp("");
              }}>{t("authBackSignInMethods")}</Button>
              <Button className="text-button" isDisabled={submitting} onPress={changeEmail}>{t("authChangeEmail")}</Button>
            </Form>
          ),
        };
      case "choose-password":
        return {
          title: t("authSetPassword"),
          description: hasGoogle
            ? t("authChoosePasswordGoogleDescription")
            : t("authChoosePasswordDescription"),
          form: (
            <Form className="entry-form" onSubmit={setFirstPassword}>
              <EmailSummary email={email} />
              <PasswordField label={t("authPasswordMinLabel", { min: PASSWORD_POLICY.minLength })} value={password}
                onChange={setPassword} autoComplete="new-password" autoFocus />
              <PasswordField label={t("authConfirmPassword")} value={passwordConfirmation}
                onChange={setPasswordConfirmation} autoComplete="new-password" />
              <Button type="submit" isDisabled={submitting}>{submitting ? t("authSettingPassword") : t("authSetPasswordAndSignIn")}</Button>
              <Button className="text-button" isDisabled={submitting} onPress={() => {
                setView("verify-password"); setMessage(null); setPassword(""); setPasswordConfirmation("");
              }}>{t("authBackVerifyEmail")}</Button>
              <Button className="text-button" isDisabled={submitting} onPress={changeEmail}>{t("authChangeEmail")}</Button>
            </Form>
          ),
        };
      case "password-set":
        return {
          title: t("authPasswordSet"),
          description: hasGoogle
            ? t("authPasswordSetGoogleDescription")
            : t("authPasswordSetDescription"),
          form: <Button className="primary-button auth-primary-link" isDisabled={submitting} onPress={() => {
            setSubmitting(true);
            void finishAuthentication().finally(() => setSubmitting(false));
          }}>{t("authContinue")}</Button>,
        };
      case "request-reset":
        return {
          title: t("authForgotPassword"),
          description: t("authRequestResetDescription"),
          form: (
            <Form className="entry-form" onSubmit={requestPasswordReset}>
              <EmailSummary email={email} />
              <Button type="submit" isDisabled={submitting}>
                {submitting ? t("authSendingOtp") : t("authSendResetOtp")}
              </Button>
              <Button
                type="button"
                className="text-button"
                onPress={() => {
                  setView("sign-in");
                  setMessage(null);
                }}
              >
                {t("authBackSignIn")}
              </Button>
            </Form>
          ),
        };
      case "reset-password":
        return {
          title: t("authResetPassword"),
          description: t("authResetPasswordDescription"),
          form: (
            <Form className="entry-form" onSubmit={resetPassword}>
              <EmailSummary email={email} />
              <OtpField value={otp} onChange={setOtp} autoFocus />
              <PasswordField
                label={t("authNewPasswordMinLabel", { min: PASSWORD_POLICY.minLength })}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
              <PasswordField
                label={t("authConfirmNewPassword")}
                value={passwordConfirmation}
                onChange={setPasswordConfirmation}
                autoComplete="new-password"
              />
              <Button type="submit" isDisabled={submitting}>
                {submitting ? t("authResettingPassword") : t("authResetPasswordAndSignIn")}
              </Button>
              <Button
                type="button"
                className="text-button"
                isDisabled={submitting || otpRetrySeconds > 0}
                onPress={() => void resendPasswordResetOtp()}
              >
                {resendButtonLabel}
              </Button>
            </Form>
          ),
        };
      case "join-choir":
        return {
          title: t("authJoinDrive"),
          description: t("authJoinDriveDescription", { drive: joinChoir?.name ?? t("authThisDrive") }),
          form: (
            <Form className="entry-form" onSubmit={joinCurrentGuestChoir}>
              <TextField
                isRequired
                value={displayName}
                onChange={setDisplayName}
                maxLength={40}
              >
                <Label>{t("authDisplayName")}</Label>
                <Input
                  autoComplete="nickname"
                  placeholder={t("authDisplayNameExample")}
                  autoFocus
                />
                <AuthFieldError maxLength={40} />
              </TextField>
              <Button type="submit" isDisabled={submitting}>
                {submitting ? t("authJoiningDrive") : t("authJoinAndEnter")}
              </Button>
            </Form>
          ),
        };
      case "join-result":
        return {
          title: t("authSignedIn"),
          description: t("authJoinFailedDescription"),
          form: (
            <><Button isDisabled={submitting} onPress={() => void finishAuthentication()}>{t("authRetryJoin")}</Button>
            <Button className="secondary-button" onPress={() => void cancelEntry()}>{t("authCancelToDriveList")}</Button></>
          ),
        };
    }
  })();

  return (
    <div ref={authPageRef} className="app-page auth-page">
      <AppHeader
        actions={<LanguageSelect />}
        onHome={returnTarget ? undefined : event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          void cancelEntry();
        }}
      />
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="auth-title">
          <h1 id="auth-title" ref={titleRef} tabIndex={-1}>
            {viewPanel.title}
          </h1>
          {viewPanel.description && <p className="auth-description">{viewPanel.description}</p>}
          {viewPanel.form}

          {(view === "identify" || view === "sign-in") && socialProviders.length > 0 ? (
            <SocialAuthOptions
              providers={socialProviders}
              disabled={submitting}
              onContinue={(provider) => void startSocialAuthentication(provider)}
            />
          ) : null}

          {message ? (
            <p className="form-message" role="status">
              {message(t)}
            </p>
          ) : null}
        </section>
        {returnTarget?.startsWith("/choirs/") && returnReader?.action !== "open" && <Button className="text-button auth-read-only" onPress={() => void cancelEntry()}>{t("authContinueReadOnly")}</Button>}
      </main>
    </div>
  );
}

function SocialAuthOptions(props: {
  providers: SocialAuthProvider[];
  disabled: boolean;
  onContinue(provider: SocialAuthProvider): void;
}) {
  const t = useMessages("entry");
  return (
    <section className="social-auth-options" aria-labelledby="social-auth-label">
      <div className="social-auth-divider">
        <span id="social-auth-label">{t("authOtherSignInMethods")}</span>
      </div>
      <div className="social-auth-buttons">
        {props.providers.includes("google") ? (
          <Button
            type="button"
            className="social-auth-button"
            isDisabled={props.disabled}
            onPress={() => props.onContinue("google")}
          >
            <GoogleIcon />
            {t("authContinueGoogle")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="#4285f4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z"
      />
      <path
        fill="#34a853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.37l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.6-4.12H3.05v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#fbbc05"
        d="M6.4 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.32-1.93V7.45H3.05A10 10 0 0 0 2 12c0 1.61.38 3.14 1.05 4.55l3.35-2.62Z"
      />
      <path
        fill="#ea4335"
        d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.95 5.45l3.35 2.62A5.98 5.98 0 0 1 12 5.95Z"
      />
    </svg>
  );
}

function readSocialEmailDraft() {
  try {
    return sessionStorage.getItem(SOCIAL_EMAIL_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeSocialEmailDraft(email: string) {
  try {
    if (email) sessionStorage.setItem(SOCIAL_EMAIL_DRAFT_KEY, email);
    else sessionStorage.removeItem(SOCIAL_EMAIL_DRAFT_KEY);
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function clearSocialEmailDraft() {
  try {
    sessionStorage.removeItem(SOCIAL_EMAIL_DRAFT_KEY);
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

async function confirmAuthenticatedSession() {
  const lifecycle = await diagnosticFetch("/api/user/lifecycle", { cache: "no-store" })
    .then(async (response) => response.ok ? response.json() : null).catch(() => null);
  if (lifecycle?.deletion) return true;
  const response = await diagnosticFetch("/api/auth/get-session", {
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return false;
  return authSessionResponseSchema.safeParse(await response.json()).success;
}

function EmailField(props: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const t = useMessages("entry");
  return (
    <TextField
      isRequired
      type="email"
      value={props.value}
      onChange={props.onChange}
    >
      <Label>{t("authEmail")}</Label>
      <Input
        autoComplete="email"
        placeholder={t("authEmailExample")}
        autoFocus={props.autoFocus}
      />
      <AuthFieldError />
    </TextField>
  );
}

function EmailSummary({ email }: { email: string }) {
  const t = useMessages("entry");
  return (
    <p className="auth-email" aria-label={t("authEmailSummary", { email: normalizedEmail(email) })}>
      {normalizedEmail(email)}
    </p>
  );
}

function PasswordField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
}) {
  return (
    <TextField
      isRequired
      type="password"
      value={props.value}
      onChange={props.onChange}
      minLength={PASSWORD_POLICY.minLength}
      maxLength={PASSWORD_POLICY.maxLength}
    >
      <Label>{props.label}</Label>
      <Input autoComplete={props.autoComplete} autoFocus={props.autoFocus} />
      <AuthFieldError minLength={PASSWORD_POLICY.minLength} maxLength={PASSWORD_POLICY.maxLength} />
    </TextField>
  );
}

function OtpField(props: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const t = useMessages("entry");
  return (
    <TextField
      isRequired
      value={props.value}
      onChange={props.onChange}
      minLength={6}
      maxLength={6}
    >
      <Label>{t("authOtp")}</Label>
      <Input
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        placeholder={t("authOtpExample")}
        autoFocus={props.autoFocus}
      />
      <AuthFieldError otp />
    </TextField>
  );
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function AuthFieldError({ otp, minLength, maxLength }: {
  otp?: boolean;
  minLength?: number;
  maxLength?: number;
}) {
  const t = useMessages("entry");

  return <FieldError>{({ validationDetails: validity }) => {
    if (validity.valueMissing) return t("authFieldRequired");
    if (validity.typeMismatch) return t("authEmailInvalid");
    if (otp) return t("authOtpDigits");
    if (validity.tooShort && minLength !== undefined) return t("authPasswordMinimum", { min: minLength });
    if (validity.tooLong && maxLength !== undefined) return t("authFieldTooLong", { max: maxLength });
    return t("authFieldInvalid");
  }}</FieldError>;
}

async function postJson(locale: AppLocale, path: string, body: unknown) {
  try {
    return await diagnosticFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": locale },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

function validPasswordConfirmation(password: string, confirmation: string) {
  return (
    password.length >= PASSWORD_POLICY.minLength &&
    password.length <= PASSWORD_POLICY.maxLength && password === confirmation
  );
}
