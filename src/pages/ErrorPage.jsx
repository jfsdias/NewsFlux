import { Button, Result } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useEffect } from "react"
import { useNavigate, useRouteError } from "react-router"

import { polyglotState } from "@/hooks/useLanguage"
import hideSpinner from "@/utils/loading"
import { getSafeRequestErrorDetails } from "@/utils/safe-request-error"

const ErrorPage = () => {
  const navigate = useNavigate()
  const error = useRouteError()
  const { polyglot } = useStore(polyglotState)
  const errorDetails = getSafeRequestErrorDetails(error, "route")
  const pageKey =
    !error || errorDetails.status === 404
      ? "not_found"
      : errorDetails.status === 401
        ? "authentication"
        : errorDetails.status === 403
          ? "forbidden"
          : errorDetails.status !== null && errorDetails.status >= 500
            ? "server"
            : "generic"
  const resultStatus =
    pageKey === "not_found"
      ? "404"
      : pageKey === "forbidden"
        ? "403"
        : pageKey === "server"
          ? "500"
          : "error"
  const recoveryPath = pageKey === "authentication" ? "/login" : "/"
  const recoveryLabel = pageKey === "authentication" ? "error_page.sign_in" : "error_page.back_home"

  if (error) {
    console.error("Route error:", errorDetails)
  }

  useEffect(() => {
    hideSpinner()
  }, [])

  return (
    <div id="error-page" style={{ top: "30%", position: "relative" }}>
      <Result
        status={resultStatus}
        subTitle={polyglot?.t(`error_page.${pageKey}_description`) ?? "Return home and try again."}
        extra={[
          <Button key="back" type="primary" onClick={() => navigate(recoveryPath)}>
            {polyglot?.t(recoveryLabel) ?? "Back to Home"}
          </Button>,
        ]}
        title={
          <h1 style={{ color: "inherit", font: "inherit", margin: 0 }}>
            {polyglot?.t(`error_page.${pageKey}_title`) ?? "Page could not be opened"}
          </h1>
        }
      />
    </div>
  )
}

export default ErrorPage
