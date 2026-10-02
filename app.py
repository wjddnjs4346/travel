"""여행 일정관리 — Streamlit 배포용 진입점.

앱 자체는 index.html + css/ + js/ 의 HTML/JS 앱이고, 이 파일은 그것을 Streamlit 화면에 담기만 한다.
- index.html이 불러오는 CSS·JS를 읽어 한 HTML 문자열로 합친 뒤 components.html(iframe)로 띄운다.
  (iframe은 srcdoc으로 만들어져 css/·js/ 같은 상대 경로를 읽을 수 없기 때문에 합친다)
- 데이터는 지금처럼 각 사용자 브라우저의 localStorage에 저장된다. 서버에는 아무것도 저장하지 않는다.
- 앱을 고칠 때는 js/·css/만 고치면 된다. 파일이 바뀌면 다음 접속 때 다시 합친다.

실행: streamlit run app.py
"""
from pathlib import Path
import re

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).parent
# iframe 기본 높이. 아래 CSS가 화면 높이(100dvh)로 늘리므로, CSS가 듣지 않는 환경에서만 쓰인다.
FALLBACK_HEIGHT = 900

CSS_LINK = re.compile(r'<link rel="stylesheet" href="(css/[^"]+)">')
JS_TAG = re.compile(r'<script src="(js/[^"]+)"></script>')


def source_files():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    return [ROOT / "index.html"] + [ROOT / p for p in CSS_LINK.findall(html) + JS_TAG.findall(html)]


# 앱은 Streamlit 화면과 같은 출처(allow-same-origin)라서 바깥 문서를 고칠 수 있다.
# 화면 낭독기가 앱 영역을 "st.iframe"이 아니라 앱 이름으로, 안내를 영어가 아니라 한국어로 읽게 한다.
A11Y_SCRIPT = """<script>
try {
  if (window.frameElement) window.frameElement.title = '여행 일정관리';
  if (window.parent !== window) window.parent.document.documentElement.lang = 'ko';
} catch (e) { /* 출처가 다르면 건너뛴다 */ }
</script>"""


@st.cache_data(show_spinner=False)
def build_html(version):
    """index.html의 로컬 CSS·JS를 <style>·<script>로 바꿔 넣는다.

    version: 파일 수정 시각 묶음. 이 값이 캐시 키라서 파일이 바뀌면 다시 만든다.
    (이름을 _로 시작하면 Streamlit이 캐시 키에서 빼므로, 고쳐도 반영되지 않는다)
    """
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = CSS_LINK.sub(lambda m: "<style>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8") + "\n</style>", html)
    html = JS_TAG.sub(lambda m: "<script>\n" + (ROOT / m.group(1)).read_text(encoding="utf-8") + "\n</script>", html)
    return html.replace("</body>", A11Y_SCRIPT + "\n</body>", 1)


st.set_page_config(page_title="여행 일정관리", page_icon="✈️", layout="wide", initial_sidebar_state="collapsed")

# Streamlit 기본 머리글·여백을 숨기고, 앱(iframe)이 화면 전체를 쓰게 한다.
st.markdown(
    """
    <style>
      header[data-testid="stHeader"], [data-testid="stToolbar"], [data-testid="stDecoration"], footer { display: none !important; }
      [data-testid="stMainBlockContainer"], .block-container { padding: 0 !important; max-width: none !important; }
      [data-testid="stVerticalBlock"] { gap: 0 !important; }
      [data-testid="stAppViewContainer"], [data-testid="stMain"] { overflow: hidden !important; }
      iframe { display: block; width: 100%; height: 100vh !important; height: 100dvh !important; border: 0; }
    </style>
    """,
    unsafe_allow_html=True,
)

files = source_files()
missing = [str(p.relative_to(ROOT)) for p in files if not p.exists()]
if missing:
    st.error("앱 파일을 찾을 수 없습니다: " + ", ".join(missing))
    st.stop()

page = build_html(tuple(p.stat().st_mtime_ns for p in files))
components.html(page, height=FALLBACK_HEIGHT, scrolling=True)
