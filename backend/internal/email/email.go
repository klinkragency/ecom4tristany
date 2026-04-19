// Package email sends transactional emails via SMTP. Kept deliberately small
// (no external deps) so we can swap to Resend/Postmark/SES later by changing
// a single Send function. In dev we point SMTP_HOST at mailpit on :1025 and
// browse captured messages at http://localhost:8025.
package email

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"mime"
	"net/smtp"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/config"
)

type Sender struct {
	cfg *config.Config
}

func New(cfg *config.Config) *Sender {
	return &Sender{cfg: cfg}
}

type Message struct {
	To      string
	Subject string
	HTML    string
	Text    string // optional fallback; auto-derived from HTML if empty
}

// Send pushes `m` over SMTP. Returns nil on success. Logs and returns the
// error on failure — callers should decide whether to surface that to end
// users (for order confirmation: fire-and-forget is fine).
func (s *Sender) Send(m Message) error {
	if m.To == "" || m.Subject == "" || (m.HTML == "" && m.Text == "") {
		return fmt.Errorf("email: missing to / subject / body")
	}
	if m.Text == "" {
		m.Text = stripHTML(m.HTML)
	}
	from := fmt.Sprintf("%s <%s>", mime.QEncoding.Encode("utf-8", s.cfg.EmailFromName), s.cfg.EmailFrom)
	addr := fmt.Sprintf("%s:%d", s.cfg.SMTPHost, s.cfg.SMTPPort)

	body := buildMIME(from, m.To, m.Subject, m.Text, m.HTML)

	var auth smtp.Auth
	if s.cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", s.cfg.SMTPUser, s.cfg.SMTPPass, s.cfg.SMTPHost)
	}
	// net/smtp.SendMail handles STARTTLS automatically when the server offers it.
	if err := smtp.SendMail(addr, auth, s.cfg.EmailFrom, []string{m.To}, body); err != nil {
		slog.Error("email send", "to", m.To, "subject", m.Subject, "err", err)
		return err
	}
	slog.Info("email sent", "to", m.To, "subject", m.Subject)
	return nil
}

// SendAsync fires Send in a goroutine. Used for order emails where a slow
// SMTP server shouldn't block the webhook response.
func (s *Sender) SendAsync(m Message) {
	go func() { _ = s.Send(m) }()
}

// ─── MIME builder ────────────────────────────────────────────────────────

func buildMIME(from, to, subject, text, html string) []byte {
	boundary := randomBoundary()
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "From: %s\r\n", from)
	fmt.Fprintf(&buf, "To: %s\r\n", to)
	fmt.Fprintf(&buf, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", subject))
	fmt.Fprintf(&buf, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	fmt.Fprintf(&buf, "Message-ID: <%s@shop.local>\r\n", randomBoundary())
	fmt.Fprintf(&buf, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&buf, "Content-Type: multipart/alternative; boundary=%s\r\n\r\n", boundary)

	// Plain text part
	fmt.Fprintf(&buf, "--%s\r\n", boundary)
	fmt.Fprintf(&buf, "Content-Type: text/plain; charset=utf-8\r\n")
	fmt.Fprintf(&buf, "Content-Transfer-Encoding: 8bit\r\n\r\n")
	buf.WriteString(text)
	buf.WriteString("\r\n")

	// HTML part
	fmt.Fprintf(&buf, "--%s\r\n", boundary)
	fmt.Fprintf(&buf, "Content-Type: text/html; charset=utf-8\r\n")
	fmt.Fprintf(&buf, "Content-Transfer-Encoding: 8bit\r\n\r\n")
	buf.WriteString(html)
	buf.WriteString("\r\n")

	fmt.Fprintf(&buf, "--%s--\r\n", boundary)
	return buf.Bytes()
}

func randomBoundary() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// stripHTML is a very coarse fallback text renderer — enough to give email
// clients that only render plain text a readable version. We don't try to
// reproduce layouts; HTML clients see the real template.
func stripHTML(s string) string {
	// Replace <br>, </p>, </li>, </tr> with newlines first.
	r := strings.NewReplacer(
		"<br>", "\n", "<br/>", "\n", "<br />", "\n",
		"</p>", "\n\n", "</li>", "\n", "</tr>", "\n",
	)
	s = r.Replace(s)
	// Strip tags.
	var buf bytes.Buffer
	depth := 0
	for _, c := range s {
		switch c {
		case '<':
			depth++
		case '>':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 {
				buf.WriteRune(c)
			}
		}
	}
	// Collapse >2 newlines.
	out := strings.TrimSpace(buf.String())
	for strings.Contains(out, "\n\n\n") {
		out = strings.ReplaceAll(out, "\n\n\n", "\n\n")
	}
	return out
}
