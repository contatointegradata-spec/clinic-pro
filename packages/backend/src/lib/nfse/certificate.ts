import forge from 'node-forge'

// ─── Certificado digital A1 (PKCS#12 / .pfx) ─────────────────────────────────
// Usado para (1) assinar a DPS / pedidos de evento (XMLDSig) e (2) autenticar
// a conexão mTLS com a Sefin Nacional. node-forge é usado SÓ para ler o .pfx
// e extrair chave/certificado em PEM — a assinatura é feita pelo crypto nativo
// do Node (via xml-crypto).

export interface ParsedCertificate {
  privateKeyPem: string
  certificatePem: string
  subject: string
  documento: string | null // CNPJ/CPF do titular (ICP-Brasil), se identificável
  validFrom: Date
  validTo: Date
}

export class CertificateError extends Error {}

// OIDs ICP-Brasil no subjectAltName (otherName): CNPJ e dados do PF (CPF após a data de nascimento).
const OID_CNPJ = '2.16.76.1.3.3'
const OID_PF = '2.16.76.1.3.1'

function extractDocumento(cert: forge.pki.Certificate): string | null {
  const san = cert.getExtension('subjectAltName') as { altNames?: Array<{ type: number; value: unknown }> } | null
  for (const alt of san?.altNames ?? []) {
    // otherName (type 0): value é ASN.1 [OID, [0] valor]
    if (alt.type !== 0 || !Array.isArray(alt.value)) continue
    try {
      const parts = alt.value as forge.asn1.Asn1[]
      const oid = forge.asn1.derToOid(parts[0].value as string)
      const inner = JSON.stringify(parts[1]?.value ?? '')
      const digits = inner.replace(/\D/g, '')
      if (oid === OID_CNPJ && digits.length >= 14) return digits.slice(-14)
      if (oid === OID_PF && digits.length >= 19) return digits.slice(8, 19)
    } catch {
      // segue para o fallback pelo CN
    }
  }
  // Padrão ICP-Brasil no CN: "NOME DO TITULAR:12345678000190"
  const cn = cert.subject.getField('CN')?.value as string | undefined
  const m = cn?.match(/:(\d{14}|\d{11})\s*$/)
  return m ? m[1] : null
}

export function parsePfx(pfx: Buffer, password: string): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')))
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password)
  } catch {
    throw new CertificateError('Não foi possível abrir o certificado — confira o arquivo .pfx e a senha.')
  }

  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
    ?? p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]
  if (!keyBag?.key) throw new CertificateError('O arquivo não contém a chave privada do certificado (precisa ser um certificado A1 .pfx).')

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  // Certificado do titular = o que corresponde à chave privada (a cadeia pode vir junto).
  const publicKey = forge.pki.setRsaPublicKey((keyBag.key as forge.pki.rsa.PrivateKey).n, (keyBag.key as forge.pki.rsa.PrivateKey).e)
  const publicPem = forge.pki.publicKeyToPem(publicKey)
  const certBag = certBags.find(b => b.cert && forge.pki.publicKeyToPem(b.cert.publicKey) === publicPem) ?? certBags[0]
  if (!certBag?.cert) throw new CertificateError('O arquivo não contém o certificado do titular.')
  const cert = certBag.cert

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificatePem: forge.pki.certificateToPem(cert),
    subject: (cert.subject.getField('CN')?.value as string | undefined) ?? cert.subject.attributes.map(a => `${a.shortName}=${a.value}`).join(', '),
    documento: extractDocumento(cert),
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  }
}
