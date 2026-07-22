export const studentPhoneInputDigits = (value: string): string => value.replace(/\D/gu, '')

export const studentPhoneDigits = (value: string): string => studentPhoneInputDigits(value).slice(0, 11)

export const formatStudentPhoneInput = (value: string): string => {
  const digits = studentPhoneDigits(value)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}
