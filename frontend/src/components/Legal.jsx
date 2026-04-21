export default function Legal({ page, onBack }) {
  const isPrivacy = page === "privacy";

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px", fontFamily: "DM Sans, sans-serif" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#7a7a6e", fontSize: 13, cursor: "pointer", marginBottom: 24, fontFamily: "DM Sans, sans-serif" }}>
        ← Back
      </button>

      <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 32, marginBottom: 8 }}>
        {isPrivacy ? "Privacy Policy" : "Terms of Service"}
      </div>
      <div style={{ fontSize: 13, color: "#7a7a6e", marginBottom: 40 }}>
        Last updated: April 14, 2026 · Billtiq (billtiq.com)
      </div>

      {isPrivacy ? <PrivacyContent /> : <TermsContent />}

      <div style={{ marginTop: 48, padding: "24px", background: "#f5f2eb", borderRadius: 12, fontSize: 13, color: "#7a7a6e", lineHeight: 1.7 }}>
        <strong style={{ color: "#0a0f1e" }}>Questions?</strong> Contact us at{" "}
        <a href="mailto:hello@billtiq.com" style={{ color: "#e8531a" }}>hello@billtiq.com</a>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 12, color: "#0a0f1e" }}>{title}</div>
      <div style={{ fontSize: 14, color: "#4a4a42", lineHeight: 1.8 }}>{children}</div>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div>
      <Section title="1. Introduction">
        Billtiq ("we", "our", or "us") is committed to protecting your personal information. This Privacy Policy explains how we collect, use, and safeguard your data when you use our AI-powered invoice processing platform at billtiq.com.
      </Section>

      <Section title="2. Information We Collect">
        <strong>Account Information:</strong> Name, email address, and password when you create an account.<br /><br />
        <strong>Invoice Data:</strong> When you upload invoices, our AI extracts structured data including vendor names, amounts, dates, and line items. We do not permanently store the original PDF files.<br /><br />
        <strong>Usage Data:</strong> Log data, IP addresses, browser type, and pages visited to improve our service.<br /><br />
        <strong>Payment Information:</strong> Billing details processed securely through Stripe. We do not store credit card numbers.
      </Section>

      <Section title="3. How We Use Your Information">
        We use your information to:<br /><br />
        • Provide and improve the Billtiq service<br />
        • Process invoices using AI extraction<br />
        • Send notifications about invoice processing<br />
        • Communicate account-related updates<br />
        • Detect and prevent fraudulent activity<br />
        • Comply with legal obligations
      </Section>

      <Section title="4. Data Storage and Security">
        Your data is stored securely using Supabase (PostgreSQL) with row-level security policies ensuring each user can only access their own data. All data transmission is encrypted using TLS/HTTPS. We implement industry-standard security measures including JWT authentication and OAuth 2.0.
      </Section>

      <Section title="5. Data Sharing">
        We do not sell your personal data. We share data only with:<br /><br />
        • <strong>Service providers</strong> (Supabase, Vercel, Render, Resend, Stripe) who assist in operating our platform<br />
        • <strong>ERP systems</strong> you explicitly connect (QuickBooks, Oracle Fusion, etc.)<br />
        • <strong>Law enforcement</strong> when required by law
      </Section>

      <Section title="6. Invoice Data Retention">
        Extracted invoice data is retained in your account until you delete it. Original PDF files are processed in memory and are not permanently stored on our servers. You may request deletion of your data at any time by contacting hello@billtiq.com.
      </Section>

      <Section title="7. Your Rights">
        You have the right to:<br /><br />
        • Access your personal data<br />
        • Correct inaccurate data<br />
        • Request deletion of your data<br />
        • Export your data<br />
        • Withdraw consent at any time<br /><br />
        To exercise these rights, contact us at hello@billtiq.com.
      </Section>

      <Section title="8. Cookies">
        We use essential cookies for authentication and session management. We do not use tracking or advertising cookies.
      </Section>

      <Section title="9. Third-Party Services">
        Billtiq integrates with third-party services including Anthropic (AI processing), Supabase (database), Stripe (payments), and Resend (email). Each service has its own privacy policy governing their data handling.
      </Section>

      <Section title="10. Changes to This Policy">
        We may update this Privacy Policy periodically. We will notify you of significant changes via email or in-app notification. Continued use of Billtiq after changes constitutes acceptance of the updated policy.
      </Section>

      <Section title="11. Contact Us">
        For privacy-related questions or requests, contact us at hello@billtiq.com.
      </Section>
    </div>
  );
}

function TermsContent() {
  return (
    <div>
      <Section title="1. Acceptance of Terms">
        By accessing or using Billtiq at billtiq.com, you agree to be bound by these Terms of Service. If you do not agree, please do not use our service. These terms apply to all users, including individuals and organizations.
      </Section>

      <Section title="2. Description of Service">
        Billtiq is an AI-powered invoice processing platform that extracts data from invoice documents, matches them against purchase orders, detects duplicates, and integrates with ERP systems. We provide this service on a subscription basis.
      </Section>

      <Section title="3. Account Registration">
        You must provide accurate and complete information when creating an account. You are responsible for maintaining the security of your account credentials. You must notify us immediately of any unauthorized access. We reserve the right to terminate accounts that violate these terms.
      </Section>

      <Section title="4. Acceptable Use">
        You agree NOT to:<br /><br />
        • Upload invoices or documents you do not have rights to process<br />
        • Use Billtiq for any illegal or fraudulent activity<br />
        • Attempt to reverse engineer or hack the platform<br />
        • Share your account credentials with unauthorized users<br />
        • Upload malicious files or content<br />
        • Violate any applicable laws or regulations
      </Section>

      <Section title="5. Subscription and Billing">
        Billtiq offers Free, Starter ($299/month), Growth ($799/month), and Enterprise plans. Subscriptions are billed monthly. You may upgrade or downgrade at any time. Refunds are provided at our discretion. We reserve the right to change pricing with 30 days notice.
      </Section>

      <Section title="6. Data and Privacy">
        You retain ownership of all invoice data you upload. By using Billtiq, you grant us a limited license to process your data for the purpose of providing the service. We handle your data in accordance with our Privacy Policy.
      </Section>

      <Section title="7. AI Processing Accuracy">
        Billtiq uses AI to extract invoice data. While we strive for high accuracy, AI extraction is not 100% perfect. You are responsible for reviewing and verifying all extracted data before approving invoices. Billtiq is not liable for errors in AI-extracted data that are not caught during review.
      </Section>

      <Section title="8. ERP Integrations">
        Billtiq integrates with third-party ERP systems. We are not responsible for data loss, errors, or issues caused by third-party ERP systems. You are responsible for ensuring your ERP credentials are kept secure.
      </Section>

      <Section title="9. Limitation of Liability">
        Billtiq is provided "as is" without warranties of any kind. We are not liable for any indirect, incidental, or consequential damages arising from use of our service. Our total liability is limited to the amount you paid us in the last 3 months.
      </Section>

      <Section title="10. Intellectual Property">
        Billtiq and its original content, features, and functionality are owned by Billtiq and protected by intellectual property laws. You may not copy, modify, or distribute our platform without written permission.
      </Section>

      <Section title="11. Termination">
        We may suspend or terminate your account for violation of these terms, non-payment, or at our discretion with 30 days notice. Upon termination, your data will be retained for 30 days before deletion.
      </Section>

      <Section title="12. Changes to Terms">
        We reserve the right to modify these terms at any time. We will provide notice of significant changes via email. Continued use after changes constitutes acceptance of the updated terms.
      </Section>

      <Section title="13. Governing Law">
        These terms are governed by applicable laws. Any disputes shall be resolved through binding arbitration.
      </Section>

      <Section title="14. Contact">
        For questions about these terms, contact us at hello@billtiq.com.
      </Section>
    </div>
  );
}
