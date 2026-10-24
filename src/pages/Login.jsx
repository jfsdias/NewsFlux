import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  Link,
  Message,
  Notification,
  Typography,
} from "@arco-design/web-react"
import useForm from "@arco-design/web-react/es/Form/useForm"
import { IconHome, IconLock, IconUser } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router"

import useLanguage, { polyglotState } from "@/hooks/useLanguage"
import useTheme from "@/hooks/useTheme"
import { authState } from "@/store/authState"
import { settingsState, updateSettings } from "@/store/settingsState"
import isValidAuth, { getSafeAuthErrorDetails, isLegacyPasswordAuth } from "@/utils/auth"
import { provisionDedicatedApiKeySession } from "@/utils/auth-apikey"
import { handleEnterKeyToSubmit, validateAndFormatFormFields } from "@/utils/form"
import { createHomeIdentity, ensureHomeIdentity, getPostLoginPath } from "@/utils/home-page"
import hideSpinner from "@/utils/loading"
import { MINIMUM_MINIFLUX_VERSION } from "@/utils/miniflux-compatibility"
import "./Login.css"

const getCompatibilityAlert = (polyglot, compatibilityError) => {
  const variables = {
    detectedVersion: compatibilityError.version || polyglot.t("compatibility.unknown_version"),
    minimumVersion: compatibilityError.minimumVersion,
  }

  if (compatibilityError.reason === "unsupported") {
    return {
      content: polyglot.t("compatibility.unsupported_description", variables),
      title: polyglot.t("compatibility.unsupported_title"),
    }
  }

  if (compatibilityError.reason === "unverifiable") {
    return {
      content: polyglot.t("compatibility.unverifiable_description", variables),
      title: polyglot.t("compatibility.unverifiable_title"),
    }
  }

  return {
    content: polyglot.t("compatibility.check_failed_description", variables),
    title: polyglot.t("compatibility.check_failed_title"),
  }
}

const Login = () => {
  useLanguage()
  useTheme()

  const auth = useStore(authState)
  const { polyglot } = useStore(polyglotState)

  const [loginForm] = useForm()
  const [loading, setLoading] = useState(false)
  const [apiKeyConsent, setApiKeyConsent] = useState(false)
  const inFlightLoginRef = useRef(false)

  const [searchParams] = useSearchParams()
  const [authMethod, setAuthMethod] = useState(() =>
    Object.fromEntries(searchParams).username ? "user" : "token",
  )
  /* token or user */
  const location = useLocation()
  const navigate = useNavigate()
  const compatibilityErrorFromNavigation = location.state?.compatibilityError

  const [redirectTo] = useState(() => location.state?.from)
  const [compatibilityError, setCompatibilityError] = useState(
    compatibilityErrorFromNavigation ?? null,
  )
  const redirectedServer = compatibilityErrorFromNavigation?.server

  const performHealthCheck = async (formAuth) => {
    if (inFlightLoginRef.current) {
      return
    }
    inFlightLoginRef.current = true
    setLoading(true)
    setCompatibilityError(null)
    const { server, token, username, password } = formAuth

    try {
      const result = await provisionDedicatedApiKeySession(
        { server, token, username, password },
        { consent: apiKeyConsent },
      )

      if (result.status === "incompatible") {
        setCompatibilityError({
          minimumVersion: result.compatibility.minimumVersion,
          reason: result.compatibility.status,
          server,
          version: result.compatibility.version,
        })
        return
      }

      const { currentUser } = result
      Notification.success({
        title: polyglot.t("login.success"),
      })
      const identity = createHomeIdentity(server, currentUser.id)
      const { homePages, homePage: legacyHomePage } = settingsState.get()
      const postLoginPath = getPostLoginPath({
        homePages,
        identity,
        legacyHomePage,
        explicitFrom: redirectTo,
      })
      updateSettings({ homePages: ensureHomeIdentity(homePages, identity, legacyHomePage) })
      navigate(postLoginPath, { replace: true })
    } catch (error) {
      const safeDetails = getSafeAuthErrorDetails(error, [password, token])

      if (error?.stage === "compatibility") {
        console.error("Failed to check Miniflux compatibility:", safeDetails)
        setCompatibilityError({
          minimumVersion: MINIMUM_MINIFLUX_VERSION,
          reason: "check-failed",
          server,
        })
        return
      }

      if (error?.code === "INVALID_USER_IDENTITY") {
        Notification.error({
          title: polyglot.t("login.error"),
          content: polyglot.t("login.invalid_identity"),
        })
        return
      }

      if (error?.code === "AUTH_CONSENT_REQUIRED") {
        Message.error(polyglot.t("login.api_key_consent_required"))
        return
      }

      if (
        error?.stage === "create-key" ||
        error?.stage === "verify-key" ||
        error?.stage === "store-auth"
      ) {
        console.error("Dedicated API key provisioning failed:", safeDetails)
        Notification.error({
          title: polyglot.t("login.error"),
          content: polyglot.t("login.api_key_provisioning_error"),
        })
        return
      }

      console.error("Login health check failed:", safeDetails)
      Notification.error({
        title: polyglot.t("login.error"),
        content: safeDetails.message,
      })
    } finally {
      inFlightLoginRef.current = false
      setLoading(false)
    }
  }

  const handleLogin = async (formAuth) => {
    const normalizedCandidate = {
      ...formAuth,
      token: authMethod === "token" ? formAuth?.token : "",
      username: authMethod === "user" ? formAuth?.username : "",
      password: authMethod === "user" ? formAuth?.password : "",
    }
    if (!isValidAuth(normalizedCandidate)) {
      Message.error(polyglot.t("login.auth_error"))
      return
    }
    if (authMethod === "user" && !apiKeyConsent) {
      Message.error(polyglot.t("login.api_key_consent_required"))
      return
    }
    await performHealthCheck(normalizedCandidate)
  }

  useEffect(() => {
    hideSpinner()
  }, [])

  useEffect(() => {
    const url = new URL(globalThis.location.href)
    const { server, token, username, password } = Object.fromEntries(url.searchParams)
    if (server) {
      loginForm.setFieldsValue({ server, token, username, password })
      // Only auto-submit token logins; password logins require explicit user consent to provision an API key.
      if (token) {
        loginForm.submit()
      }
    } else if (redirectedServer) {
      loginForm.setFieldsValue({ server: redirectedServer })
    }
  }, [loginForm, polyglot, redirectedServer])

  const compatibilityAlert =
    polyglot && compatibilityError ? getCompatibilityAlert(polyglot, compatibilityError) : null

  if (isValidAuth(auth) && !isLegacyPasswordAuth(auth)) {
    return <Navigate replace to={redirectTo || "/"} />
  }

  return (
    polyglot && (
      <div className="page-layout">
        <div className="form-panel">
          <div className="login-form">
            <Typography.Title heading={3}>
              {polyglot.t("login.login_to_your_server")}
            </Typography.Title>
            {compatibilityAlert && (
              <Alert
                className="login-compatibility-alert"
                content={compatibilityAlert.content}
                title={compatibilityAlert.title}
                type="error"
              />
            )}
            <Form
              autoComplete="off"
              form={loginForm}
              layout="vertical"
              onSubmit={async () => {
                if (validateAndFormatFormFields(loginForm)) {
                  history.replaceState(history.state, "", "/login")
                  await handleLogin(loginForm.getFieldsValue())
                } else {
                  Message.error(polyglot.t("login.submit_error"))
                }
              }}
            >
              <Form.Item
                field="server"
                label={polyglot.t("login.server_label")}
                rules={[{ required: true }]}
                onKeyDown={(event) => {
                  handleEnterKeyToSubmit(event, loginForm)
                }}
              >
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={loading}
                  inputMode="url"
                  placeholder={polyglot.t("login.server_placeholder")}
                  prefix={<IconHome aria-hidden="true" />}
                  spellCheck={false}
                />
              </Form.Item>
              {authMethod === "token" && (
                <Form.Item
                  field="token"
                  label={polyglot.t("login.token_label")}
                  rules={[{ required: true }]}
                  onKeyDown={(event) => {
                    handleEnterKeyToSubmit(event, loginForm)
                  }}
                >
                  <Input.Password
                    autoCapitalize="none"
                    autoCorrect="off"
                    disabled={loading}
                    placeholder={polyglot.t("login.token_placeholder")}
                    prefix={<IconLock aria-hidden="true" />}
                    spellCheck={false}
                  />
                </Form.Item>
              )}
              {authMethod === "user" && (
                <>
                  <Form.Item
                    field="username"
                    label={polyglot.t("login.username_label")}
                    rules={[{ required: true }]}
                    onKeyDown={(event) => {
                      handleEnterKeyToSubmit(event, loginForm)
                    }}
                  >
                    <Input
                      autoCapitalize="none"
                      autoCorrect="off"
                      disabled={loading}
                      placeholder={polyglot.t("login.username_placeholder")}
                      prefix={<IconUser aria-hidden="true" />}
                      spellCheck={false}
                    />
                  </Form.Item>
                  <Form.Item
                    field="password"
                    label={polyglot.t("login.password_label")}
                    rules={[{ required: true }]}
                    onKeyDown={(event) => {
                      handleEnterKeyToSubmit(event, loginForm)
                    }}
                  >
                    <Input.Password
                      autoCapitalize="none"
                      autoCorrect="off"
                      disabled={loading}
                      placeholder={polyglot.t("login.password_placeholder")}
                      prefix={<IconLock aria-hidden="true" />}
                      spellCheck={false}
                    />
                  </Form.Item>
                  <div className="login-api-key-consent">
                    <Checkbox
                      checked={apiKeyConsent}
                      disabled={loading}
                      onChange={setApiKeyConsent}
                    >
                      {polyglot.t("login.api_key_consent_label")}
                    </Checkbox>
                  </div>
                </>
              )}
            </Form>
            <Button
              loading={loading}
              long={true}
              style={{ marginTop: "20px" }}
              type="primary"
              onClick={() => loginForm.submit()}
            >
              {polyglot.t("login.login_button")}
            </Button>
            <Divider>{polyglot.t("login.another_login_method")}</Divider>
            <Button
              long={true}
              style={{ marginTop: "20px" }}
              type="secondary"
              onClick={() => setAuthMethod(authMethod === "token" ? "user" : "token")}
            >
              {authMethod === "token"
                ? polyglot.t("login.another_login_button")
                : polyglot.t("login.token_label")}
            </Button>
            <div className="login-help">
              <Typography.Text disabled>{polyglot.t("login.need_help")}</Typography.Text>
              <Link
                href={"https://miniflux.app/docs/api.html#authentication"}
                style={{ fontWeight: "500" }}
              >
                {polyglot.t("login.miniflux_official_website")}
              </Link>
            </div>
          </div>
        </div>
        <div className="background" />
      </div>
    )
  )
}

export default Login
