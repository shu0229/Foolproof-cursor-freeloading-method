import os
import time
from sys import platform
from datetime import datetime

from DrissionPage import ChromiumOptions, Chromium

CURSOR_URL = "https://www.cursor.com/"
CURSOR_LOGIN_URL = "https://authenticator.cursor.sh"
CURSOR_SETTINGS_URL = "https://www.cursor.com/settings"

def get_cursor_token():
    """获取用户手动登录后的Cursor Token并保存到文件"""
    browser = None
    try:
        print("正在初始化浏览器...", flush=True)
        options = ChromiumOptions()
        options.auto_port()
        options.headless(False)  # 必须显示浏览器
        options.set_argument('--start-maximized')  # 最大化窗口
        
        if platform == "linux" or platform == "linux2":
            platformIdentifier = "X11; Linux x86_64"
        elif platform == "darwin":
            platformIdentifier = "Macintosh; Intel Mac OS X 10_15_7"
        elif platform == "win32":
            platformIdentifier = "Windows NT 10.0; Win64; x64"
        options.set_user_agent(f"Mozilla/5.0 ({platformIdentifier}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        
        print("浏览器已启动，等待登录...", flush=True)
        browser = Chromium(options)
        tab = browser.new_tab(CURSOR_LOGIN_URL)
        
        print("请在打开的浏览器中登录Cursor...", flush=True)
        print("登录成功后将自动获取Token并关闭浏览器", flush=True)
        
        token_obtained = False
        retry_count = 0
        max_retries = 300  # 5分钟超时
        
        while retry_count < max_retries:
            try:
                # 检查所有可能的Cookie
                all_cookies = tab.cookies()
                for cookie in all_cookies:
                    if cookie.get('name') == 'WorkosCursorSessionToken':
                        token = cookie.get('value')
                        if token:
                            print("成功获取Token！", flush=True)
                            save_token(token)
                            token_obtained = True
                            print("Token已保存，浏览器将在3秒后关闭...", flush=True)
                            time.sleep(3)
                            browser.quit()
                            return True
                
                # 检查URL重定向
                current_url = tab.url
                if current_url == CURSOR_URL or current_url.startswith(CURSOR_SETTINGS_URL):
                    cookies_dict = tab.cookies().as_dict()
                    token = cookies_dict.get('WorkosCursorSessionToken')
                    if token:
                        print("成功获取Token！", flush=True)
                        save_token(token)
                        token_obtained = True
                        print("Token已保存，浏览器将在3秒后关闭...", flush=True)
                        time.sleep(3)
                        browser.quit()
                        return True
                
                time.sleep(1)
                retry_count += 1
                
                if retry_count % 30 == 0:  # 每30秒提示一次
                    print(f"等待登录中... ({retry_count//30}/10 分钟)", flush=True)
                
            except Exception as e:
                if not browser.is_alive():
                    print("浏览器已关闭，未获取到Token", flush=True)
                    return False
                print(f"检查状态时出错: {str(e)}", flush=True)
                time.sleep(1)
                retry_count += 1
        
        print("获取Token超时，请重试", flush=True)
        if browser:
            browser.quit()
        return False
            
    except Exception as e:
        print(f"错误: {str(e)}", flush=True)
        if browser:
            browser.quit()
        return False

def save_token(token):
    """保存token到文件"""
    try:
        token_file = os.path.join(os.path.dirname(__file__), 'token.txt')
        
        existing_tokens = []
        if os.path.exists(token_file):
            with open(token_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    existing_tokens = [t.strip() for t in content.split(',') if t.strip()]
        
        if token not in existing_tokens:
            existing_tokens.append(token)
            with open(token_file, 'w', encoding='utf-8') as f:
                f.write(','.join(existing_tokens))
            
            print(f"[Token] 已保存到文件: {token_file}", flush=True)
            print(f"[Token] 当前共有 {len(existing_tokens)} 个token", flush=True)
            print(f"[Token] 新增Token成功", flush=True)
        else:
            print(f"[Token] Token已存在，当前共有 {len(existing_tokens)} 个token", flush=True)
    except Exception as e:
        print(f"保存Token失败: {str(e)}", flush=True)

if __name__ == "__main__":
    print("="*50)
    print("Cursor Token 获取工具")
    print("="*50)
    
    success = get_cursor_token()
    if not success:
        print("未能获取有效Token")
    print("="*50)