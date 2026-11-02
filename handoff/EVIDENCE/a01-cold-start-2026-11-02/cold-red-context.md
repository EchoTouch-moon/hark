# Test info

- Name: hearth-permissions-csrf.spec.ts >> 全新浏览器和空服务端会话可进入授权并重新读取真实火候
- Location: tests/e2e/hearth-permissions-csrf.spec.ts:10:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '去授权' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: '去授权' }) with timeout 10000ms
  - waiting for getByRole('button', { name: '去授权' })

```

```yaml
- link "跳到主要内容":
  - /url: "#main-content"
- banner:
  - button "Hearth 返回对话": Hearth
  - text: 火候未知
  - group
- main:
  - alert:
    - paragraph: 火候未知
    - text: missing or invalid session UNAUTHORIZED
  - button "重新读取"
  - text: 输入消息
  - textbox "输入消息":
    - /placeholder: 说说你正在想的事…
  - button "发送" [disabled]
```
