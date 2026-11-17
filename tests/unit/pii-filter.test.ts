import { describe, it, expect } from 'vitest'
import { redactPII, containsPII } from '../../src/security/pii-filter.service.js'

describe('pii-filter — task-008 (RS-3.5)', () => {
  describe('email redaction', () => {
    it('should_redact_simple_email', () => {
      expect(redactPII('contato: john.doe@example.com')).toBe('contato: [EMAIL_REMOVIDO]')
    })

    it('should_redact_multiple_emails', () => {
      const result = redactPII('a@b.com e c.d+filter@x-y.co.uk')
      expect(result).toBe('[EMAIL_REMOVIDO] e [EMAIL_REMOVIDO]')
    })
  })

  describe('telefone BR redaction', () => {
    it('should_redact_celular_with_parens', () => {
      const result = redactPII('me liga em (11) 98765-4321')
      expect(result).toContain('[TELEFONE_REMOVIDO]')
    })

    it('should_redact_celular_with_country_code', () => {
      const result = redactPII('whatsapp +55 11 98765-4321')
      expect(result).toContain('[TELEFONE_REMOVIDO]')
    })

    it('should_redact_celular_without_separator', () => {
      const result = redactPII('11987654321')
      expect(result).toContain('[TELEFONE_REMOVIDO]')
    })
  })

  describe('CPF redaction', () => {
    it('should_redact_formatted_cpf', () => {
      expect(redactPII('CPF 123.456.789-00')).toBe('CPF [CPF_REMOVIDO]')
    })
  })

  describe('CNPJ redaction', () => {
    it('should_redact_formatted_cnpj', () => {
      expect(redactPII('CNPJ 12.345.678/0001-90')).toBe('CNPJ [CNPJ_REMOVIDO]')
    })
  })

  describe('CEP redaction', () => {
    it('should_redact_formatted_cep', () => {
      expect(redactPII('CEP 01310-100')).toBe('CEP [CEP_REMOVIDO]')
    })
  })

  describe('idempotência', () => {
    it('should_be_idempotent_applied_twice', () => {
      const once = redactPII('john@example.com e CPF 111.222.333-44')
      const twice = redactPII(once)
      expect(once).toBe(twice)
    })
  })

  describe('containsPII', () => {
    it('should_return_true_for_text_with_email', () => {
      expect(containsPII('contact me at foo@bar.com')).toBe(true)
    })

    it('should_return_false_for_clean_text', () => {
      expect(containsPII('Vídeo sobre automação com IA — sem dados pessoais')).toBe(false)
    })
  })

  describe('combined attacks', () => {
    it('should_redact_all_PII_types_in_one_pass', () => {
      const input = 'Contato: a@b.com, fone (11) 98765-4321, CPF 111.222.333-44, CNPJ 12.345.678/0001-90, CEP 01310-100'
      const result = redactPII(input)
      expect(result).toContain('[EMAIL_REMOVIDO]')
      expect(result).toContain('[TELEFONE_REMOVIDO]')
      expect(result).toContain('[CPF_REMOVIDO]')
      expect(result).toContain('[CNPJ_REMOVIDO]')
      expect(result).toContain('[CEP_REMOVIDO]')
    })
  })
})
