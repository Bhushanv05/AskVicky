import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, StatusBar,
  ActivityIndicator, SafeAreaView, Animated, Alert, ScrollView,
  Image, Linking, Clipboard
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── CONFIG ────────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY || '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const STORAGE_KEY = 'askvicky_current';
const RECENTS_KEY = 'askvicky_recents';

const SYSTEM_PROMPT = `You are AskVicky — a highly capable, friendly AI assistant for everyone — professionals, students, and anyone who needs help. You can help with absolutely any topic:

- SQL & Databases: Oracle SQL, PL/SQL, Finacle CBS schema (tbaadm, crmuser, custom tables like gam, lam, lht, ldt, eab)
- Banking & Finance: RBI guidelines, NPA classification, NABARD rules, NACH/NPCI, co-operative banking, Finacle CBS operations
- Mathematics: EMI, simple/compound interest, NPA provisioning. Always use Indian format (Rs, lakhs, crores)
- Coding: Python, JavaScript, Shell scripting, any programming language
- Writing: Emails, reports, letters, translations (Marathi, Hindi, English)
- General Knowledge: Science, history, law, current affairs, technology, any topic
- Career: Resume writing, interview tips, productivity

Always give complete, accurate, practical answers. Show step-by-step for calculations. Format code properly. Be helpful, warm and professional.`;

const QUICK_CHIPS = [
  { id: '1', icon: '🗄️', label: 'SQL Query',    prompt: 'Write a SQL query to find all NPA accounts with overdue amount from tbaadm schema' },
  { id: '2', icon: '🧮', label: 'EMI Calc',     prompt: 'Calculate EMI for a loan of Rs 10,00,000 at 9% interest for 5 years. Show step by step.' },
  { id: '3', icon: '🐍', label: 'Python',       prompt: 'Write a Python script to read a CSV file and calculate column totals' },
  { id: '4', icon: '🏦', label: 'NPA Rules',    prompt: 'Explain RBI guidelines for NPA classification with examples' },
  { id: '5', icon: '🌏', label: 'Translate',    prompt: 'Translate to Marathi: Good morning, how are you? I need your help with this work.' },
  { id: '6', icon: '⚙️', label: 'Shell Script', prompt: 'Write a shell script to take Oracle database backup and send email alert' },
  { id: '7', icon: '📊', label: 'Interest',     prompt: 'Calculate compound interest on Rs 5,00,000 for 3 years at 8.5% per annum' },
  { id: '8', icon: '✉️', label: 'Email Writer', prompt: 'OPEN_EMAIL_APP' },
];

const C = {
  bg:         '#0a0f0a',
  surface:    '#111811',
  surface2:   '#182018',
  surface3:   '#1f281f',
  accent:     '#22c55e',
  accent2:    '#4ade80',
  text:       '#e8f0e8',
  textDim:    '#6b806b',
  textMid:    '#9bab9b',
  border:     'rgba(255,255,255,0.07)',
  userBubble: '#1a2e1a',
  aiBubble:   '#141e14',
};

// ── MESSAGE RENDERER ──────────────────────────────────────────────────────────
function MessageContent({ text }) {
  const lines = text.split('\n');
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <View key={`code_${i}`} style={styles.codeBlock}>
          {lang ? <Text style={styles.codeLang}>{lang.toUpperCase()}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText}>{codeLines.join('\n')}</Text>
          </ScrollView>
        </View>
      );
      i++; continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<Text key={`h3_${i}`} style={styles.h3}>{line.slice(4).replace(/\*\*/g, '')}</Text>);
      i++; continue;
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      elements.push(<Text key={`h2_${i}`} style={styles.h2}>{line.replace(/^#+\s/, '').replace(/\*\*/g, '')}</Text>);
      i++; continue;
    }
    if (line.match(/^[\*\-] /)) {
      elements.push(
        <View key={`li_${i}`} style={styles.listItem}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.listText}>{line.slice(2).replace(/\*\*(.+?)\*\*/g, '$1')}</Text>
        </View>
      );
      i++; continue;
    }
    const numMatch = line.match(/^(\d+)\. (.+)/);
    if (numMatch) {
      elements.push(
        <View key={`num_${i}`} style={styles.listItem}>
          <Text style={styles.bullet}>{numMatch[1]}.</Text>
          <Text style={styles.listText}>{numMatch[2].replace(/\*\*(.+?)\*\*/g, '$1')}</Text>
        </View>
      );
      i++; continue;
    }
    if (line.trim() === '') {
      elements.push(<View key={`sp_${i}`} style={{ height: 5 }} />);
      i++; continue;
    }
    const clean = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1');
    elements.push(<Text key={`t_${i}`} style={styles.msgText}>{clean}</Text>);
    i++;
  }
  return <>{elements}</>;
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showRecents, setShowRecents] = useState(false);
  const [recentChats, setRecentChats] = useState([]);
  const flatListRef = useRef(null);
  const fadeAnim    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    loadRecents();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setShowWelcome(false);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30))).catch(() => {});
      saveToRecents();
    }
  }, [messages]);

  async function loadRecents() {
    try {
      const saved = await AsyncStorage.getItem(RECENTS_KEY);
      if (saved) setRecentChats(JSON.parse(saved));
    } catch (e) {}
  }

  async function saveToRecents() {
    try {
      const saved = await AsyncStorage.getItem(RECENTS_KEY);
      const recents = saved ? JSON.parse(saved) : [];
      const firstMsg = messages[0]?.content?.slice(0, 50) || 'Chat session';
      const now = new Date();
      const timeStr = now.toLocaleDateString('en-IN') + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const sessionId = messages[0]?.id || 'session_1';
      const existing = recents.findIndex(r => r.id === sessionId);
      const session = { id: sessionId, preview: firstMsg, time: timeStr, messages: messages.slice(-30), count: messages.length };
      if (existing >= 0) { recents[existing] = session; } else { recents.unshift(session); }
      const updated = recents.slice(0, 20);
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
      setRecentChats(updated);
    } catch (e) {}
  }

  function startNewChat() {
    setMessages([]);
    setShowWelcome(true);
    setShowRecents(false);
    setInput('');
  }

  function openRecentChat(session) {
    setMessages(session.messages);
    setShowWelcome(false);
    setShowRecents(false);
  }

  async function deleteRecent(sessionId) {
    try {
      const updated = recentChats.filter(r => r.id !== sessionId);
      setRecentChats(updated);
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
    } catch (e) {}
  }

  function clearHistory() {
    Alert.alert('Clear All', 'Delete all chat history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          await AsyncStorage.multiRemove([STORAGE_KEY, RECENTS_KEY]).catch(() => {});
          setMessages([]);
          setRecentChats([]);
          setShowWelcome(true);
          setShowRecents(false);
        }
      }
    ]);
  }

  function copyToClipboard(text) {
    Clipboard.setString(text);
    Alert.alert('✅ Copied!', 'Response copied to clipboard');
  }

  async function sendMessage(textOverride) {
    const text = (textOverride || input).trim();
    if (!text || loading) return;
    if (text === 'OPEN_EMAIL_APP') {
      Linking.openURL('http://vickys-email-writer.streamlit.app/');
      return;
    }
    setInput('');
    setLoading(true);
    setShowWelcome(false);
    const userMsg = { id: `u_${Date.now()}`, role: 'user', content: text };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...allMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
          ],
          max_tokens: 1500,
          temperature: 0.7,
        }),
      });
      const data = await response.json();
      let reply = 'Sorry, I could not get a response. Please try again.';
      if (data?.choices?.[0]?.message?.content) {
        reply = data.choices[0].message.content;
      } else if (data?.error?.message) {
        reply = `Error: ${data.error.message}`;
      }
      setMessages(prev => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: `e_${Date.now()}`, role: 'assistant', content: '⚠️ Network error. Please check your internet and try again.' }]);
    }
    setLoading(false);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);
  }

  function renderMessage({ item }) {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAI]}>
        {!isUser && (
          <Image source={require('./assets/icon.png')} style={styles.avatarImg} />
        )}
        <View style={{ maxWidth: '78%' }}>
          <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
            {isUser
              ? <Text style={styles.msgText}>{item.content}</Text>
              : <MessageContent text={item.content} />
            }
          </View>
          {!isUser && (
            <TouchableOpacity style={styles.copyBtn} onPress={() => copyToClipboard(item.content)}>
              <Text style={styles.copyBtnText}>📋 Copy response</Text>
            </TouchableOpacity>
          )}
        </View>
        {isUser && (
          <View style={[styles.avatar, styles.avatarUser]}>
            <Text style={[styles.avatarText, { color: C.accent, fontSize: 10 }]}>ME</Text>
          </View>
        )}
      </View>
    );
  }

  // ── RECENTS SCREEN ──────────────────────────────────────────────────────────
  if (showRecents) {
    return (
      <SafeAreaView style={[styles.safe, { paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 }]}>
        <StatusBar barStyle="light-content" backgroundColor={C.surface} translucent={false} />
        <View style={styles.recentsScreen}>
          <View style={styles.recentsHeader}>
            <TouchableOpacity onPress={() => setShowRecents(false)} style={styles.backBtn}>
              <Text style={styles.backBtnText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.recentsTitle}>Recent Chats</Text>
            <TouchableOpacity onPress={startNewChat} style={styles.newChatBtn}>
              <Text style={styles.newChatBtnText}>+ New</Text>
            </TouchableOpacity>
          </View>
          {recentChats.length === 0 ? (
            <View style={styles.emptyRecents}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyText}>No recent chats yet</Text>
              <Text style={styles.emptySubText}>Start a conversation and it will appear here!</Text>
            </View>
          ) : (
            <FlatList
              data={recentChats}
              keyExtractor={item => item.id}
              contentContainerStyle={{ padding: 16, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.recentItem} onPress={() => openRecentChat(item)}>
                  <View style={styles.recentItemLeft}>
                    <Text style={styles.recentPreview} numberOfLines={2}>💬 {item.preview}</Text>
                    <Text style={styles.recentMeta}>{item.count} messages · {item.time}</Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteRecent(item.id)} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── MAIN SCREEN ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.safe, { paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.surface} translucent={false} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLogo}>
           <Text style={{ fontSize: 22, color: C.bg, fontWeight: '800' }}>V</Text>
         </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>AskVicky</Text>
          <Text style={styles.headerSub}>Ask anything, anytime — Get it done!</Text>
        </View>
        <View style={styles.onlinePill}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>LIVE</Text>
        </View>
        <TouchableOpacity style={styles.recentsBtn} onPress={() => setShowRecents(true)}>
          <Text style={styles.recentsBtnText}>Recents</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearBtn} onPress={clearHistory}>
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.chipsBar} contentContainerStyle={styles.chipsContent}>
        {QUICK_CHIPS.map(chip => (
          <TouchableOpacity key={chip.id} style={styles.chip} onPress={() => sendMessage(chip.prompt)}>
            <Text style={{ fontSize: 13 }}>{chip.icon}</Text>
            <Text style={styles.chipLabel}>{chip.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={25}>

        {/* Welcome Screen */}
        {showWelcome ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.welcomeContent}>
            <View style={styles.welcomeIcon}>
              <Text style={{ fontSize: 32, color: C.bg }}>✦</Text>
            </View>
            <Text style={styles.welcomeTitle}>Hello! I'm AskVicky</Text>
            <Text style={styles.welcomeDesc}>Ask anything, anytime — Get it done! I'm here to help with any topic, any time! 🚀</Text>
            <View style={styles.capGrid}>
              {[
                { icon: '🗄️', t: 'SQL & Oracle',  d: 'Finacle schema, PL/SQL' },
                { icon: '💻', t: 'Coding',         d: 'Python, Shell, JS' },
                { icon: '🧮', t: 'Calculations',   d: 'EMI, interest, tax' },
                { icon: '🏦', t: 'Banking',        d: 'RBI rules, NPA, CBS' },
                { icon: '✍️', t: 'Writing',        d: 'Emails, reports' },
                { icon: '🌍', t: 'Any Topic',      d: 'Science, law, history' },
              ].map((c, idx) => (
                <View key={idx} style={styles.capCard}>
                  <Text style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</Text>
                  <Text style={styles.capTitle}>{c.t}</Text>
                  <Text style={styles.capDesc}>{c.d}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 10 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Typing Indicator */}
        {loading && (
          <View style={[styles.msgRow, styles.msgRowAI, { paddingHorizontal: 16, paddingBottom: 4 }]}>
            <Image source={require('./assets/icon.png')} style={styles.avatarImg} />
            <View style={[styles.bubble, styles.bubbleAI, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={{ fontSize: 13, color: C.textDim, fontStyle: 'italic' }}>AskVicky is thinking...</Text>
            </View>
          </View>
        )}

        {/* Input */}
        <View style={styles.inputArea}>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask me anything..."
              placeholderTextColor={C.textDim}
              multiline
              maxLength={4000}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.4 }]}
              onPress={() => sendMessage()}
              disabled={!input.trim() || loading}
            >
              <Text style={{ fontSize: 16, color: C.bg, fontWeight: '700' }}>➤</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.inputHint}>Powered by Groq AI · Llama 3.3 · Chat history saved ✅</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.bg },
  header:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  headerLogo:     { width: 34, height: 34, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { fontSize: 14, fontWeight: '700', color: C.text },
  headerSub:      { fontSize: 10, color: C.textDim, marginTop: 1 },
  onlinePill:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 },
  onlineDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },
  onlineText:     { fontSize: 10, color: C.accent, fontWeight: '600' },
  recentsBtn:     { backgroundColor: C.surface2, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
  recentsBtnText: { fontSize: 11, color: C.accent },
  clearBtn:       { backgroundColor: C.surface2, borderWidth: 1, borderColor: 'rgba(255,80,80,0.3)', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
  clearBtnText:   { fontSize: 11, color: '#f87171' },
  chipsBar:       { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, maxHeight: 48 },
  chipsContent:   { paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' },
  chip:           { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipLabel:      { fontSize: 11, color: C.textMid },
  msgRow:         { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  msgRowUser:     { justifyContent: 'flex-end' },
  msgRowAI:       { justifyContent: 'flex-start' },
  avatar:         { width: 32, height: 32, borderRadius: 9, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0 },
  avatarImg:      { width: 32, height: 32, borderRadius: 9, marginTop: 2, flexShrink: 0 },
  avatarUser:     { backgroundColor: C.surface3, borderWidth: 1, borderColor: C.border },
  avatarText:     { fontSize: 14, fontWeight: '700', color: C.bg },
  bubble:         { borderRadius: 14, padding: 12, borderWidth: 1 },
  bubbleUser:     { backgroundColor: C.userBubble, borderColor: C.border, borderTopRightRadius: 4 },
  bubbleAI:       { backgroundColor: C.aiBubble, borderColor: C.border, borderTopLeftRadius: 4 },
  msgText:        { fontSize: 14, color: C.text, lineHeight: 21 },
  h2:             { fontSize: 15, fontWeight: '700', color: C.accent2, marginVertical: 5 },
  h3:             { fontSize: 13, fontWeight: '700', color: C.accent2, marginVertical: 4 },
  listItem:       { flexDirection: 'row', gap: 8, marginVertical: 2 },
  bullet:         { fontSize: 14, color: C.accent, minWidth: 18 },
  listText:       { fontSize: 14, color: C.text, lineHeight: 21, flex: 1 },
  codeBlock:      { backgroundColor: '#080c08', borderRadius: 9, borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)', padding: 12, marginVertical: 8 },
  codeLang:       { fontSize: 10, color: C.accent, marginBottom: 6, letterSpacing: 1 },
  codeText:       { fontSize: 12, color: '#a5f3c0', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 20 },
  copyBtn:        { alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.surface2, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  copyBtnText:    { fontSize: 11, color: C.textDim },
  welcomeContent: { alignItems: 'center', padding: 24, paddingTop: 28 },
  welcomeIcon:    { width: 68, height: 68, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  welcomeTitle:   { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 10 },
  welcomeDesc:    { fontSize: 13, color: C.textMid, textAlign: 'center', lineHeight: 20, maxWidth: 320, marginBottom: 24 },
  capGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', width: '100%' },
  capCard:        { width: '45%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14 },
  capTitle:       { fontSize: 12, fontWeight: '600', color: C.text, marginBottom: 3 },
  capDesc:        { fontSize: 10, color: C.textDim, lineHeight: 14 },
  inputArea:      { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  inputBox:       { flexDirection: 'row', alignItems: 'flex-end', gap: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 },
  input:          { flex: 1, fontSize: 14, color: C.text, maxHeight: 120, paddingVertical: 4, lineHeight: 20 },
  sendBtn:        { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  inputHint:      { fontSize: 10, color: C.textDim, textAlign: 'center', marginTop: 7 },
  recentsScreen:  { flex: 1, backgroundColor: C.bg },
  recentsHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  recentsTitle:   { fontSize: 16, fontWeight: '700', color: C.text },
  backBtn:        { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  backBtnText:    { fontSize: 12, color: C.textMid },
  newChatBtn:     { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  newChatBtnText: { fontSize: 12, color: C.bg, fontWeight: '700' },
  emptyRecents:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:      { fontSize: 48, marginBottom: 16 },
  emptyText:      { fontSize: 16, fontWeight: '600', color: C.text, marginBottom: 8 },
  emptySubText:   { fontSize: 13, color: C.textDim, textAlign: 'center' },
  recentItem:     { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center' },
  recentItemLeft: { flex: 1 },
  recentPreview:  { fontSize: 13, color: C.text, marginBottom: 5, lineHeight: 19 },
  recentMeta:     { fontSize: 11, color: C.textDim },
  deleteBtn:      { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,80,80,0.1)', alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  deleteBtnText:  { fontSize: 12, color: '#f87171' },
});
