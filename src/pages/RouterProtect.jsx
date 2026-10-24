import { Alert, Button, Checkbox, Result } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router"

import RouteLoadingState from "@/components/ui/RouteLoadingState"
import useLanguage, { polyglotState } from "@/hooks/useLanguage"
import useTheme from "@/hooks/useTheme"
import { authState } from "@/store/authState"
import { dataState, setVerifiedServer } from "@/store/dataState"
import { setCurrentRoutePath } from "@/store/locationState"
import isValidAuth, {
  getAuthSessionKey,
  getSafeAuthErrorDetails,
  isLegacyPasswordAuth,
} from "@/utils/auth"
import { migrateLegacyPasswordSession } from "@/utils/auth-apikey"
import hideSpinner from "@/utils/loading"
import {
  checkMinifluxCompatibility,
  MINIMUM_MINIFLUX_VERSION,
} from "@/utils/miniflux-compatibility"
import { clearSession, logoutSession, resetSessionData } from "@/utils/session"
import "./RouterProtect.css"

const INITIAL_CHECK_STATE = { status: "checking" }

const LegacyPasswordMigrationGate = ({ auth, currentLocation, onLogout }) => {
  useLanguage()
  useTheme()

  const { polyglot } = useStore(polyglotState)
  const navigate = useNavigate()
  const [consent, setConsent] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const gateRef = useRef(null)

  useEffect(() => {
    if (polyglot) {
      hideSpinner()
    }
  }, [polyglot])

  useEffect(() => {
    if (polyglot && errorMessage) {
      gateRef.current?.focus()
    }
  }, [errorMessage, polyglot])

  if (!polyglot) {
    return null
  }

  const handleMigrate = async () => {
    if (!consent) {
      setErrorMessage(polyglot.t("login.api_key_consent_required"))
      return
    }

    setMigrating(true)
    setErrorMessage("")
    try {
      const result = await migrateLegacyPasswordSession({
        auth,
        consent: true,
      })

      if (result.status === "incompatible") {
        clearSession()
        void navigate("/login", {
          replace: true,
          state: {
            compatibilityError: {
              minimumVersion: result.compatibility.minimumVersion,
              reason: result.compatibility.status,
              server: auth.server,
              version: result.compatibility.version,
            },
            from: currentLocation,
          },
        })
      }
    } catch (error) {
      if (error?.status === 401) {
        clearSession()
        void navigate("/login", { replace: true, state: { from: currentLocation } })
        return
      }
      console.error(
        "Legacy password migration failed:",
        getSafeAuthErrorDetails(error, [auth.password, auth.token]),
      )
      setErrorMessage(polyglot.t("login.api_key_provisioning_error"))
    } finally {
      setMigrating(false)
    }
  }

  return (
    <main className="compatibility-gate compatibility-gate-result-state">
      <div ref={gateRef} className="compatibility-gate-result" role="region" tabIndex={-1}>
        <Result
          status="info"
          subTitle={polyglot.t("login.api_key_migration_description")}
          title={polyglot.t("login.api_key_migration_title")}
          extra={
            <div className="legacy-auth-migration-controls">
              {errorMessage && (
                <Alert
                  className="legacy-auth-migration-alert"
                  content={errorMessage}
                  type="error"
                />
              )}
              <div className="legacy-auth-migration-consent">
                <Checkbox checked={consent} disabled={migrating} onChange={setConsent}>
                  {polyglot.t("login.api_key_consent_label")}
                </Checkbox>
              </div>
              <div className="compatibility-gate-actions">
                <Button
                  disabled={!consent}
                  loading={migrating}
                  type="primary"
                  onClick={handleMigrate}
                >
                  {polyglot.t("login.api_key_migration_action")}
                </Button>
                <Button disabled={migrating} type="secondary" onClick={onLogout}>
                  {polyglot.t("sidebar.logout")}
                </Button>
              </div>
            </div>
          }
        />
      </div>
    </main>
  )
}

const CompatibilityGate = ({ checkState, onLogout, onRetry }) => {
  useLanguage()
  useTheme()

  const { polyglot } = useStore(polyglotState)
  const alertRef = useRef(null)

  useEffect(() => {
    if (polyglot) {
      hideSpinner()
    }
  }, [polyglot])

  useEffect(() => {
    if (polyglot && checkState.status === "error") {
      alertRef.current?.focus()
    }
  }, [checkState.status, polyglot])

  if (!polyglot) {
    return null
  }

  if (checkState.status === "checking") {
    return (
      <RouteLoadingState
        className="compatibility-gate"
        label={polyglot.t("compatibility.checking")}
      />
    )
  }

  const detectedVersion = checkState.version || polyglot.t("compatibility.unknown_version")
  const isUnverifiable = checkState.reason === "unverifiable"
  const title = polyglot.t(
    isUnverifiable ? "compatibility.unverifiable_title" : "compatibility.check_failed_title",
  )
  const description = polyglot.t(
    isUnverifiable
      ? "compatibility.unverifiable_description"
      : "compatibility.check_failed_description",
    {
      detectedVersion,
      minimumVersion: checkState.minimumVersion,
    },
  )

  return (
    <main className="compatibility-gate compatibility-gate-result-state">
      <div ref={alertRef} className="compatibility-gate-result" role="alert" tabIndex={-1}>
        <Result
          status="error"
          subTitle={description}
          title={title}
          extra={
            <div className="compatibility-gate-actions">
              <Button type="primary" onClick={onRetry}>
                {polyglot.t("actions.retry")}
              </Button>
              <Button type="secondary" onClick={onLogout}>
                {polyglot.t("sidebar.logout")}
              </Button>
            </div>
          }
        />
      </div>
    </main>
  )
}

const RouterProtect = () => {
  const auth = useStore(authState)
  const { verifiedAuthSessionKey, version } = useStore(dataState, {
    keys: ["verifiedAuthSessionKey", "version"],
  })
  const location = useLocation()
  const navigate = useNavigate()
  const [retryCount, setRetryCount] = useState(0)
  const [checkState, setCheckState] = useState(INITIAL_CHECK_STATE)

  const { password, server, token, username } = auth
  const authSessionKey = getAuthSessionKey(auth)
  const hasValidAuth = isValidAuth(auth)
  const requiresLegacyPasswordMigration = hasValidAuth && isLegacyPasswordAuth(auth)
  const hasVerifiedSession =
    !requiresLegacyPasswordMigration &&
    Boolean(version) &&
    verifiedAuthSessionKey === authSessionKey
  const currentLocation = `${location.pathname}${location.search}${location.hash}`
  const activeCheckState =
    checkState.authSessionKey === authSessionKey ? checkState : INITIAL_CHECK_STATE

  useLayoutEffect(() => {
    setCurrentRoutePath(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    if (!hasValidAuth || requiresLegacyPasswordMigration || hasVerifiedSession) {
      return
    }

    if (version || verifiedAuthSessionKey) {
      resetSessionData()
      return
    }

    const abortController = new AbortController()
    let isActive = true

    const checkCompatibility = async () => {
      try {
        const result = await checkMinifluxCompatibility(
          { password, server, token, username },
          { signal: abortController.signal },
        )

        if (!isActive) {
          return
        }

        if (result.status === "supported") {
          setVerifiedServer({ authSessionKey, version: result.version })
          return
        }

        if (result.status === "unsupported") {
          clearSession()
          void navigate("/login", {
            replace: true,
            state: {
              compatibilityError: {
                minimumVersion: result.minimumVersion,
                reason: result.status,
                server,
                version: result.version,
              },
              from: currentLocation,
            },
          })
          return
        }

        setCheckState({
          authSessionKey,
          minimumVersion: result.minimumVersion,
          reason: result.status,
          status: "error",
          version: result.version,
        })
      } catch (error) {
        if (!isActive) {
          return
        }

        if (error?.status === 401) {
          clearSession()
          void navigate("/login", { replace: true, state: { from: currentLocation } })
          return
        }

        console.error(
          "Failed to check Miniflux compatibility:",
          getSafeAuthErrorDetails(error, [password, token]),
        )
        setCheckState({
          authSessionKey,
          minimumVersion: MINIMUM_MINIFLUX_VERSION,
          reason: "check-failed",
          status: "error",
        })
      }
    }

    void checkCompatibility()

    return () => {
      isActive = false
      abortController.abort()
    }
  }, [
    authSessionKey,
    retryCount,
    currentLocation,
    hasValidAuth,
    hasVerifiedSession,
    navigate,
    password,
    requiresLegacyPasswordMigration,
    server,
    token,
    username,
    verifiedAuthSessionKey,
    version,
  ])

  if (!hasValidAuth) {
    return <Navigate replace state={{ from: currentLocation }} to="/login" />
  }

  const handleLogout = async () => {
    await logoutSession()
    void navigate("/login", { replace: true, state: { from: currentLocation } })
  }

  if (requiresLegacyPasswordMigration) {
    return (
      <LegacyPasswordMigrationGate
        auth={auth}
        currentLocation={currentLocation}
        onLogout={handleLogout}
      />
    )
  }

  if (hasVerifiedSession) {
    return <Outlet />
  }

  const handleRetry = () => {
    setCheckState({ authSessionKey, status: "checking" })
    setRetryCount((count) => count + 1)
  }

  return (
    <CompatibilityGate
      checkState={activeCheckState}
      onLogout={handleLogout}
      onRetry={handleRetry}
    />
  )
}

export default RouterProtect
