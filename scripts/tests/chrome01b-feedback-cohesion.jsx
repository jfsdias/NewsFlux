/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
/* eslint-disable unicorn/prefer-global-this -- Harness exposes automation probes to window. */

import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import "@/index.css"
import "@/theme.css"
import "@/App.css"
import "@/components/Content/FooterPanel.css"

import {
  Button,
  Message,
  Modal,
  Notification,
  Popconfirm,
  Radio,
  Select,
} from "@arco-design/web-react"
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { applyColor } from "@/utils/colors"
import { confirmDialogProps, destructiveConfirmButtonProps } from "@/utils/confirm-dialog"

const searchParams = new URLSearchParams(window.location.search)
const initialThemeColor = searchParams.get("theme") || "Yellow"
const initialView = searchParams.get("view") || "all"

const triggerToast = () => {
  Message.info({
    content: "Feed updated successfully",
    duration: 100_000,
    id: "test-message-toast",
  })
}

const triggerNotification = () => {
  Notification.info({
    id: "test-undo-notification",
    title: "Articles marked as read",
    content: "Marked all 24 articles as read in Current Feed.",
    duration: 100_000,
    btn: (
      <Button
        id="btn-undo-action"
        type="primary"
        onClick={() => {
          Notification.remove("test-undo-notification")
        }}
      >
        Undo
      </Button>
    ),
  })
}

function Harness() {
  const [themeColor, setThemeColor] = useState(initialThemeColor)
  const [modalVisible, setModalVisible] = useState(initialView === "modal")
  const [destructiveModalVisible, setDestructiveModalVisible] = useState(
    initialView === "destructive",
  )
  const [popconfirmVisible, setPopconfirmVisible] = useState(true)

  useEffect(() => {
    applyColor(themeColor, "dark")
  }, [themeColor])

  useEffect(() => {
    window.triggerToast = triggerToast
    window.triggerNotification = triggerNotification
    triggerToast()
    triggerNotification()
  }, [])

  return (
    <div
      style={{
        padding: "16px",
        maxWidth: "960px",
        margin: "0 auto",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Mock Compact Nav Header */}
      <header
        id="mock-compact-nav"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "48px",
          background: "#15191e",
          borderBottom: "1px solid #2a3037",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          boxSizing: "border-box",
        }}
      >
        <span style={{ fontWeight: 600 }}>NewsFlux Chrome</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <Button size="small" onClick={() => setThemeColor("Yellow")}>
            Gold
          </Button>
          <Button size="small" onClick={() => setThemeColor("Red")}>
            Crimson
          </Button>
          <Button size="small" onClick={() => setThemeColor("Blue")}>
            Blue
          </Button>
        </div>
      </header>

      {/* Spacer below fixed nav */}
      <div style={{ height: "64px" }} />

      <h2 style={{ fontSize: "20px", marginBottom: "16px" }}>
        CHROME-01B Runtime Visual Cohesion ({themeColor})
      </h2>

      {/* Primary Actions & Semantic Status Matrix */}
      <section
        style={{
          marginBottom: "24px",
          padding: "16px",
          background: "#15191e",
          borderRadius: "12px",
          border: "1px solid #2a3037",
        }}
      >
        <h3 style={{ fontSize: "16px", marginTop: 0, marginBottom: "12px" }}>
          Primary vs Status Action Controls
        </h3>
        <div
          id="button-matrix"
          style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}
        >
          <Button id="btn-neutral-primary" type="primary">
            Neutral Primary Action
          </Button>

          <Button
            className="destructive-confirm-action"
            id="btn-destructive"
            status="danger"
            type="primary"
          >
            Destructive Action (Danger)
          </Button>

          <Button id="btn-warning" status="warning" type="primary">
            Warning Action
          </Button>

          <Button id="btn-success" status="success" type="primary">
            Success Action
          </Button>

          <Button className="test-focus-target" id="btn-focus-target" type="primary">
            Focus Visible Target
          </Button>
        </div>
      </section>

      {/* Radio & Select & Popups */}
      <section
        style={{
          marginBottom: "24px",
          padding: "16px",
          background: "#15191e",
          borderRadius: "12px",
          border: "1px solid #2a3037",
        }}
      >
        <h3 style={{ fontSize: "16px", marginTop: 0, marginBottom: "12px" }}>
          Controls: Radio Buttons, Select, Dropdown
        </h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center" }}>
          <Radio.Group defaultValue="unread" id="test-radio-group" type="button">
            <Radio value="all">All</Radio>
            <Radio value="unread">Unread</Radio>
            <Radio value="starred">Starred</Radio>
          </Radio.Group>

          <Select popupVisible defaultValue="newest" id="test-select" style={{ width: 160 }}>
            <Select.Option value="newest">Newest first</Select.Option>
            <Select.Option value="oldest">Oldest first</Select.Option>
          </Select>

          <Popconfirm
            focusLock
            popupVisible
            cancelText="Cancel"
            className="mark-all-read-popconfirm"
            okText="Mark all as read"
            title="Mark all articles as read?"
            onVisibleChange={setPopconfirmVisible}
          >
            <Button id="btn-popconfirm-trigger">Open Popconfirm</Button>
          </Popconfirm>
        </div>
      </section>

      {/* Confirmation Dialogs */}
      <section
        style={{
          marginBottom: "24px",
          padding: "16px",
          background: "#15191e",
          borderRadius: "12px",
          border: "1px solid #2a3037",
        }}
      >
        <h3 style={{ fontSize: "16px", marginTop: 0, marginBottom: "12px" }}>
          Modal Confirmations
        </h3>
        <div style={{ display: "flex", gap: "12px" }}>
          <Button id="btn-open-neutral-modal" type="primary" onClick={() => setModalVisible(true)}>
            Open Neutral Confirm Modal
          </Button>

          <Button
            id="btn-open-destructive-modal"
            status="danger"
            onClick={() => setDestructiveModalVisible(true)}
          >
            Open Destructive Confirm Modal
          </Button>
        </div>

        {/* Neutral Modal */}
        <Modal
          {...confirmDialogProps}
          simple
          cancelText="Cancel"
          okText="Mark all as read"
          title={<span>Mark all articles as read?</span>}
          visible={modalVisible}
          onCancel={() => setModalVisible(false)}
          onOk={() => setModalVisible(false)}
        >
          <p>This will mark all 42 loaded unread articles as read in the current scope.</p>
        </Modal>

        {/* Destructive Modal */}
        <Modal
          {...confirmDialogProps}
          simple
          cancelText="Cancel"
          okButtonProps={{ ...destructiveConfirmButtonProps, status: "danger" }}
          okText="Delete Category"
          title={<span>Delete Category?</span>}
          visible={destructiveModalVisible}
          onCancel={() => setDestructiveModalVisible(false)}
          onOk={() => setDestructiveModalVisible(false)}
        >
          <p>Are you sure you want to delete this category? Feeds will become uncategorized.</p>
        </Modal>
      </section>
    </div>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
