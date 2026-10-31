// 只识别独立招呼，不吞掉“上午好，打开 Anki”等真正的任务或追问。
export function isSimpleGreeting(text: string) {
  return /^(?:上午好|早上好|早安|早呀|早啊|早|中午好|午安|下午好|晚上好|晚安|你好|您好|嗨|哈喽|哈啰|hello|hi|good morning|こんにちは|おはよう(?:ございます)?|こんばんは)[呀啊哦哟呢~～!！。.?？\s]*$/iu.test(text.trim());
}
