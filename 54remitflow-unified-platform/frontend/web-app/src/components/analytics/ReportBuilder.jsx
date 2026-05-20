import React, { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { Button, Paper, Checkbox, FormControlLabel } from '@mui/material';

const initialFields = [
  { id: 'date', label: 'Date' },
  { id: 'description', label: 'Description' },
  { id: 'amount', label: 'Amount' },
  { id: 'currency', label: 'Currency' },
];

const ReportBuilder = () => {
  const [fields, setFields] = useState(initialFields);
  const [selectedFields, setSelectedFields] = useState([]);

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(fields);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setFields(items);
  };

  const handleSelectField = (fieldId) => {
    const currentIndex = selectedFields.indexOf(fieldId);
    const newSelected = [...selectedFields];
    if (currentIndex === -1) {
      newSelected.push(fieldId);
    } else {
      newSelected.splice(currentIndex, 1);
    }
    setSelectedFields(newSelected);
  };

  const handleGenerateReport = () => {
    console.log('Generating report with fields:', selectedFields);
  };

  return (
    <Paper style={{ padding: '20px' }}>
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="fields">
          {(provided) => (
            <div {...provided.droppableProps} ref={provided.innerRef}>
              {fields.map((field, index) => (
                <Draggable key={field.id} draggableId={field.id} index={index}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      style={{ userSelect: 'none', padding: '10px', margin: '0 0 10px 0', backgroundColor: 'lightgrey', ...provided.draggableProps.style }}
                    >
                      <FormControlLabel
                        control={<Checkbox checked={selectedFields.indexOf(field.id) !== -1} onChange={() => handleSelectField(field.id)} />}
                        label={field.label}
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      <Button onClick={handleGenerateReport} variant="contained" color="primary">Generate Report</Button>
    </Paper>
  );
};

export default ReportBuilder;
