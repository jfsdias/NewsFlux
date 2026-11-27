export const validateAndFormatFormFields = (form) => {
  // Read the values of all current form fields
  const allFields = form.getFieldsValue()
  let isFormValid = true

  // Trim whitespace from every non-password field and check that all required fields are filled
  for (const [key, value] of Object.entries(allFields)) {
    if (key !== "password") {
      const trimmedValue = value?.trim()
      form.setFieldValue(key, trimmedValue) // Store the trimmed value
      if (!trimmedValue) {
        isFormValid = false // A required field is empty after trimming, so the form is invalid
      }
    } else if (!value) {
      isFormValid = false // An empty password makes the form invalid
    }
  }

  return isFormValid
}

export const handleEnterKeyToSubmit = (event, form) => {
  if (event.key === "Enter") {
    form.submit()
  }
}
