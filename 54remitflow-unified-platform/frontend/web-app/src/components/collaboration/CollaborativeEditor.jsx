import React, { useState, useEffect } from 'react';
import { Editor } from 'react-draft-wysiwyg';
import { EditorState, convertToRaw, convertFromRaw } from 'draft-js';
import 'react-draft-wysiwyg/dist/react-draft-wysiwyg.css';
import { useWebSocket } from './useWebSocket';

const CollaborativeEditor = ({ documentId }) => {
  const [editorState, setEditorState] = useState(EditorState.createEmpty());
  const { lastMessage, sendMessage } = useWebSocket(`wss://your-websocket-url/documents/${documentId}`);

  useEffect(() => {
    if (lastMessage && lastMessage.type === 'document_update') {
      const contentState = convertFromRaw(lastMessage.content);
      setEditorState(EditorState.createWithContent(contentState));
    }
  }, [lastMessage]);

  const onEditorStateChange = (newEditorState) => {
    setEditorState(newEditorState);
    const content = convertToRaw(newEditorState.getCurrentContent());
    sendMessage({ type: 'document_update', content });
  };

  return (
    <Editor
      editorState={editorState}
      onEditorStateChange={onEditorStateChange}
      wrapperClassName="wrapper-class"
      editorClassName="editor-class"
      toolbarClassName="toolbar-class"
    />
  );
};

export default CollaborativeEditor;

